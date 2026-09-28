from __future__ import annotations

import json
import math
import os
import pickle
import sys
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd

THIS_DIR = Path(__file__).resolve().parent
LOCAL_OUTPUTS_DIR = THIS_DIR / "outputs"


def _candidate_roots() -> list[Path]:
    raw_candidates = [
        Path.cwd(),
        THIS_DIR,
        THIS_DIR.parent,
        Path(os.environ["PWD"]) if os.environ.get("PWD") else None,
        Path(os.environ["LAMBDA_TASK_ROOT"]) if os.environ.get("LAMBDA_TASK_ROOT") else None,
        Path("/var/task"),
        Path("/var/task/user"),
    ]

    candidates: list[Path] = []
    seen: set[str] = set()
    for candidate in raw_candidates:
        if candidate is None:
            continue
        resolved = candidate.resolve()
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        candidates.append(resolved)

    return candidates


def _resolve_capstone_paths() -> tuple[Path, Path]:
    if LOCAL_OUTPUTS_DIR.exists():
        return THIS_DIR, LOCAL_OUTPUTS_DIR

    for root in _candidate_roots():
        outputs_dir = root / "capstone cric" / "outputs"
        if outputs_dir.exists():
            return outputs_dir.parent, outputs_dir

    for root in _candidate_roots():
        if not root.exists():
            continue
        try:
            match = next(root.rglob("aggregated_df.pkl"))
        except (OSError, StopIteration):
            continue

        outputs_dir = match.parent
        if outputs_dir.name == "outputs":
            return outputs_dir.parent, outputs_dir

    fallback_capstone = (Path.cwd() / "capstone cric").resolve()
    return fallback_capstone, fallback_capstone / "outputs"


CAPSTONE_DIR, CAPSTONE_OUTPUTS_DIR = _resolve_capstone_paths()
CAPSTONE_SRC_DIR = CAPSTONE_DIR / "src"

for path in (THIS_DIR, CAPSTONE_DIR, CAPSTONE_SRC_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

_ARTIFACT_LOCK = threading.Lock()


class T20InsightsUnavailable(RuntimeError):
    """Raised when the capstone artifacts or their dependencies are unavailable."""


def _load_optional_json(filename: str, default: Any) -> Any:
    path = CAPSTONE_OUTPUTS_DIR / filename
    if not path.exists():
        return default

    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _load_optional_pickle(filename: str, default: Any) -> Any:
    path = CAPSTONE_OUTPUTS_DIR / filename
    if not path.exists():
        return default

    try:
        with path.open("rb") as handle:
            return pickle.load(handle)
    except Exception:
        return default


def _ensure_pickle_compat() -> None:
    # Capstone artifacts were serialized with a NumPy module alias that is not
    # present in this runtime by default.
    import numpy.core.numeric as numeric

    sys.modules.setdefault("numpy._core.numeric", numeric)


def _load_dataframe(filename: str) -> pd.DataFrame:
    path = CAPSTONE_OUTPUTS_DIR / filename
    if not path.exists():
        raise T20InsightsUnavailable(f"Missing required artifact: {path}")

    _ensure_pickle_compat()
    return pd.read_pickle(path)


def _clean_number(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if math.isnan(number) or math.isinf(number):
        return None

    return number


NON_DISMISSAL_STATUSES = {
    "",
    "batting",
    "did not bat",
    "not out",
    "retired hurt",
}


def _weighted_mean(df: pd.DataFrame, value_column: str, weight_column: str = "entry_count") -> Optional[float]:
    if df.empty or value_column not in df.columns:
        return None

    values = pd.to_numeric(df[value_column], errors="coerce")
    if weight_column in df.columns:
        weights = pd.to_numeric(df[weight_column], errors="coerce").fillna(0)
        mask = values.notna() & weights.gt(0)
        if mask.any():
            return float(np.average(values[mask], weights=weights[mask]))

    valid = values.dropna()
    if valid.empty:
        return None
    return float(valid.mean())


def _dismissal_status_mask(series: pd.Series) -> pd.Series:
    normalized = series.fillna("").astype(str).str.strip().str.lower()
    return normalized.ne("") & ~normalized.isin(NON_DISMISSAL_STATUSES)


def _dismissal_metrics_reliable(entries_with_perf: pd.DataFrame, aggregated_df: pd.DataFrame) -> bool:
    if not entries_with_perf.empty and "dismissal_status" in entries_with_perf.columns:
        dismissed = _dismissal_status_mask(entries_with_perf["dismissal_status"])
        if bool(dismissed.any()):
            return True

    if not aggregated_df.empty and "dismissal_probability" in aggregated_df.columns:
        return int(aggregated_df["dismissal_probability"].dropna().nunique()) > 1

    return False


def _confidence_tier(sample_size: int, medium: int = 5, high: int = 20) -> str:
    if sample_size >= high:
        return "high"
    if sample_size >= medium:
        return "medium"
    return "low"


def _sample_warning(
    sample_size: int,
    medium: int = 5,
    high: int = 20,
    noun: str = "observations",
) -> Optional[str]:
    if sample_size >= high:
        return None
    if sample_size >= medium:
        return f"Moderate evidence only: based on {sample_size} comparable {noun}."
    if sample_size > 0:
        return f"Low-data estimate: based on just {sample_size} comparable {noun}."
    return f"No comparable {noun} were available."


def _shrink_mean(
    observed: Optional[float],
    sample_size: int,
    prior_mean: float,
    prior_strength: float,
) -> Optional[float]:
    if observed is None:
        return float(prior_mean)
    if sample_size <= 0:
        return float(prior_mean)
    return float(
        (observed * sample_size + prior_mean * prior_strength)
        / (sample_size + prior_strength)
    )


def _shrink_rate(
    observed: Optional[float],
    sample_size: int,
    prior_rate: float,
    prior_strength: float,
) -> Optional[float]:
    if observed is None:
        return float(prior_rate)
    if sample_size <= 0:
        return float(prior_rate)
    prior_successes = max(0.0, min(1.0, prior_rate)) * prior_strength
    return float(
        (observed * sample_size + prior_successes)
        / (sample_size + prior_strength)
    )


def _predictive_interval(
    center: Optional[float],
    sd: Optional[float],
    z: float = 1.28,
    label: str = "80% range",
    unit: Optional[str] = None,
    decimals: int = 1,
) -> Optional[dict[str, Any]]:
    if center is None or sd is None:
        return None
    if not math.isfinite(center) or not math.isfinite(sd) or sd < 0:
        return None
    lower = round(max(0.0, center - z * sd), decimals)
    upper = round(center + z * sd, decimals)
    return {
        "label": label,
        "lower": lower,
        "upper": upper,
        "unit": unit,
        "decimals": decimals,
    }


def _wilson_interval(
    successes: int,
    total: int,
    z: float = 1.96,
    decimals: int = 1,
) -> Optional[dict[str, Any]]:
    if total <= 0:
        return None

    p_hat = max(0.0, min(1.0, successes / total))
    z2 = z ** 2
    denominator = 1 + z2 / total
    center = (p_hat + z2 / (2 * total)) / denominator
    margin = (z / denominator) * math.sqrt(
        (p_hat * (1 - p_hat)) / total + z2 / (4 * total ** 2)
    )
    return {
        "label": "95% CI",
        "lower": round(max(0.0, center - margin) * 100, decimals),
        "upper": round(min(1.0, center + margin) * 100, decimals),
        "unit": "%",
        "decimals": decimals,
    }


def _metric_support(
    sample_size: int,
    *,
    medium: int = 5,
    high: int = 20,
    warning: Optional[str] = None,
    uncertainty: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    return {
        "sampleSize": int(max(sample_size, 0)),
        "confidenceTier": _confidence_tier(int(max(sample_size, 0)), medium=medium, high=high),
        "warning": warning,
        "uncertainty": uncertainty,
    }


def _serialize_records(df: pd.DataFrame, limit: Optional[int] = None) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []

    work = df.copy()
    if limit is not None:
        work = work.head(limit)

    work = work.replace({np.nan: None})
    return work.to_dict(orient="records")


def _normalize_gender(value: Optional[str]) -> str:
    raw = (value or "male").strip().lower()
    if raw in {"female", "women", "woman", "women's t20i", "womens"}:
        return "female"
    return "male"


def _normalize_strategy(strategy: Optional[str], innings_type: str) -> str:
    raw = (strategy or "balanced").strip().lower()
    if innings_type == "Chasing" or raw in {"aggressive", "chasing"}:
        return "chasing"
    return "batting_first"


def _normalize_player_text(value: Optional[str]) -> str:
    if not value:
        return ""

    normalized = "".join(character.lower() if character.isalnum() else " " for character in value)
    return " ".join(normalized.split())


def _player_signature(value: Optional[str]) -> str:
    tokens = _normalize_player_text(value).split()
    if not tokens:
        return ""
    if len(tokens) == 1:
        return tokens[0]
    return f"{tokens[0][0]} {tokens[-1]}"


def _player_query_rank(player_name: str, query: str) -> Optional[tuple[int, int, int]]:
    player_normalized = _normalize_player_text(player_name)
    query_normalized = _normalize_player_text(query)
    if not player_normalized or not query_normalized:
        return None

    if player_normalized == query_normalized:
        return (0, 0, len(player_normalized))

    if query_normalized in player_normalized:
        return (1, player_normalized.index(query_normalized), len(player_normalized))

    if player_normalized in query_normalized:
        return (2, query_normalized.index(player_normalized), len(player_normalized))

    player_signature = _player_signature(player_name)
    query_signature = _player_signature(query)
    if player_signature and query_signature and player_signature == query_signature:
        return (3, 0, len(player_normalized))

    player_tokens = player_normalized.split()
    query_tokens = query_normalized.split()
    if (
        len(player_tokens) >= 2
        and len(query_tokens) >= 2
        and player_tokens[-1] == query_tokens[-1]
        and player_tokens[0][0] == query_tokens[0][0]
    ):
        return (4, 0, len(player_normalized))

    if query_tokens and all(
        any(
            token in candidate_token or candidate_token in token
            for candidate_token in player_tokens
        )
        for token in query_tokens
    ):
        return (5, 0, len(player_normalized))

    return None


def _overs_to_balls(overs: float) -> int:
    whole_overs = int(overs)
    balls = int(round((overs - whole_overs) * 10 + 1e-9))
    balls = max(0, min(5, balls))
    return whole_overs * 6 + balls


def _balls_to_over_string(overs: float) -> str:
    whole_overs = int(overs)
    balls = int(round((overs - whole_overs) * 10 + 1e-9))
    balls = max(0, min(5, balls))
    return f"{whole_overs}.{balls}"


def _batting_phase(over: float) -> str:
    whole_overs = int(over)
    if whole_overs <= 5:
        return "Powerplay"
    if whole_overs <= 15:
        return "Middle"
    return "Death"


def _runs_band_batting(runs: int) -> str:
    if runs < 30:
        return "0-30"
    if runs < 60:
        return "30-60"
    if runs < 100:
        return "60-100"
    return "100+"


def _wickets_band_batting(wickets: int) -> str:
    if wickets <= 2:
        return "0-2"
    if wickets <= 4:
        return "3-4"
    return "5+"


def _required_run_rate_band(required_rr: Optional[float]) -> str:
    if required_rr is None:
        return "NA"
    if required_rr < 6:
        return "low"
    if required_rr < 9:
        return "medium"
    return "high"


def build_batting_situation_label(
    over: float,
    runs: int,
    wickets: int,
    innings: int,
    target: Optional[int] = None,
) -> tuple[str, str, Optional[float], float]:
    phase = _batting_phase(over)
    runs_band = _runs_band_batting(runs)
    wickets_band = _wickets_band_batting(wickets)

    current_balls = max(0, _overs_to_balls(over))
    current_rr = (runs * 6 / current_balls) if current_balls > 0 else 0.0

    if innings == 2 and target is not None:
        balls_left = max(1, 120 - current_balls)
        runs_needed = max(0, target - runs)
        required_rr = (runs_needed * 6) / balls_left
        innings_type = "Chasing"
    else:
        required_rr = None
        innings_type = "Batting First"

    situation_label = (
        f"{phase}|{runs_band}|{wickets_band}|{_required_run_rate_band(required_rr)}"
    )
    return situation_label, innings_type, required_rr, round(current_rr, 2)


def _bowling_overs_band(over: float) -> str:
    whole_overs = int(over)
    if whole_overs <= 5:
        return "0-5"
    if whole_overs <= 10:
        return "6-10"
    if whole_overs <= 15:
        return "11-15"
    return "16-20"


def _bowling_runs_band(runs: int) -> str:
    if runs <= 40:
        return "0-40"
    if runs <= 80:
        return "41-80"
    if runs <= 120:
        return "81-120"
    return "121+"


def _bowling_wickets_band(wickets: int) -> str:
    if wickets <= 0:
        return "0"
    if wickets <= 2:
        return "1-2"
    return "3+"


def build_bowling_situation_label(
    over: float,
    runs: int,
    wickets: int,
    innings: int,
) -> tuple[str, str]:
    innings_mode = "bowling_first" if innings == 1 else "bowling_second"
    situation_label = (
        f"{_bowling_overs_band(over)}|{_bowling_runs_band(runs)}|"
        f"{_bowling_wickets_band(wickets)}|{innings_mode}"
    )
    return situation_label, innings_mode


def _build_team_maps(filtered_df: pd.DataFrame) -> tuple[dict[str, set[str]], dict[str, str]]:
    team_to_players: dict[str, set[str]] = {}
    player_to_team: dict[str, str] = {}

    if filtered_df.empty or "batting_team" not in filtered_df.columns or "batsman" not in filtered_df.columns:
        return team_to_players, player_to_team

    slim = filtered_df[["batting_team", "batsman"]].dropna().copy()
    for team, rows in slim.groupby("batting_team"):
        players = set(rows["batsman"].astype(str).tolist())
        team_to_players[str(team)] = players

    for batsman, rows in slim.groupby("batsman"):
        modes = rows["batting_team"].mode()
        if not modes.empty:
            player_to_team[str(batsman)] = str(modes.iloc[0])

    return team_to_players, player_to_team


def _load_team_players_map() -> dict[str, set[str]]:
    team_players_map = _load_optional_json("team_players_map.json", {})
    if not isinstance(team_players_map, dict):
        return {}

    normalized: dict[str, set[str]] = {}
    for team, players in team_players_map.items():
        if not team or not isinstance(players, list):
            continue
        normalized[str(team)] = {str(player) for player in players if player}
    return normalized


@lru_cache(maxsize=1)
def load_t20_artifacts() -> dict[str, Any]:
    with _ARTIFACT_LOCK:
        try:
            artifacts = {
                "aggregated_df": _load_dataframe("aggregated_df.pkl"),
                "filtered_df": _load_optional_pickle("filtered_df.pkl", pd.DataFrame()),
                "entries_with_perf": _load_dataframe("entries_with_perf.pkl"),
                "bowling_over_df": _load_dataframe("bowling_over_df.pkl"),
                "teams_list": _load_optional_pickle("teams_list.pkl", []),
                "eval_results": _load_optional_pickle("eval_results.pkl", None),
                # The original Bayesian pickle is not portable across this runtime,
                # so the integrated experience falls back to the stable aggregated
                # statistics that the capstone UI already relied on.
                "bayes_results": None,
            }
        except Exception as exc:
            raise T20InsightsUnavailable(str(exc)) from exc

    aggregated_df = artifacts.get("aggregated_df", pd.DataFrame()).copy().drop_duplicates()
    filtered_df = artifacts.get("filtered_df", pd.DataFrame()).copy().drop_duplicates()
    bowling_over_df = artifacts.get("bowling_over_df", pd.DataFrame()).copy().drop_duplicates()
    entries_with_perf = artifacts.get("entries_with_perf", pd.DataFrame()).copy().drop_duplicates()

    player_gender_map = _load_optional_pickle("player_gender_map.pkl", {})
    player_image_urls = _load_optional_json("player_image_urls.json", {})
    player_team_map = _load_optional_json("player_team_map.json", {})
    team_to_players = _load_team_players_map()
    derived_player_to_team: dict[str, str] = {}

    if not team_to_players:
        team_to_players, derived_player_to_team = _build_team_maps(filtered_df)

    if isinstance(player_team_map, dict):
        derived_player_to_team.update(
            {str(player): str(team) for player, team in player_team_map.items() if team}
        )

    if not aggregated_df.empty and "gender" not in aggregated_df.columns and player_gender_map:
        aggregated_df["gender"] = aggregated_df["batsman"].map(player_gender_map).fillna("male")

    artifacts["aggregated_df"] = aggregated_df
    artifacts["filtered_df"] = filtered_df
    artifacts["bowling_over_df"] = bowling_over_df
    artifacts["entries_with_perf"] = entries_with_perf
    artifacts["player_gender_map"] = player_gender_map
    artifacts["player_image_urls"] = player_image_urls if isinstance(player_image_urls, dict) else {}
    artifacts["team_to_players"] = team_to_players
    artifacts["player_to_team"] = derived_player_to_team
    artifacts["dismissal_metrics_reliable"] = _dismissal_metrics_reliable(
        entries_with_perf,
        aggregated_df,
    )
    if artifacts["dismissal_metrics_reliable"]:
        global_dismissal_rate = None
        if not entries_with_perf.empty and "dismissal_status" in entries_with_perf.columns:
            dismissed = _dismissal_status_mask(entries_with_perf["dismissal_status"])
            if not dismissed.empty:
                global_dismissal_rate = float(dismissed.mean())
        if global_dismissal_rate is None:
            global_dismissal_rate = _weighted_mean(aggregated_df, "dismissal_probability")
        artifacts["global_dismissal_rate"] = (
            float(global_dismissal_rate)
            if global_dismissal_rate is not None
            else 0.25
        )
    else:
        artifacts["global_dismissal_rate"] = 0.25

    if not aggregated_df.empty and "batsman" in aggregated_df.columns:
        total_entries = (
            aggregated_df.groupby("batsman")["entry_count"].sum().sort_values(ascending=False)
            if "entry_count" in aggregated_df.columns
            else pd.Series(dtype=float)
        )
        artifacts["players"] = [str(player) for player in total_entries.index.tolist()]
    else:
        artifacts["players"] = []

    if team_to_players:
        artifacts["teams"] = sorted(team_to_players.keys())
    elif not filtered_df.empty and "batting_team" in filtered_df.columns:
        artifacts["teams"] = sorted(filtered_df["batting_team"].dropna().astype(str).unique().tolist())
    else:
        artifacts["teams"] = list(artifacts.get("teams_list", []))

    return artifacts


def _teams_for_gender(
    filtered_df: pd.DataFrame,
    gender: str,
    team_to_players: dict[str, set[str]],
    player_gender_map: dict[str, str],
) -> list[str]:
    if not filtered_df.empty and "batting_team" in filtered_df.columns:
        work = filtered_df
        if "gender" in work.columns:
            work = work[work["gender"] == gender]
        return sorted(work["batting_team"].dropna().astype(str).unique().tolist())

    if not team_to_players:
        return []

    matching_teams = []
    for team, players in team_to_players.items():
        if any(player_gender_map.get(player, "male") == gender for player in players):
            matching_teams.append(team)
    return sorted(matching_teams)


def get_metadata() -> dict[str, Any]:
    artifacts = load_t20_artifacts()
    filtered_df = artifacts.get("filtered_df", pd.DataFrame())
    aggregated_df = artifacts.get("aggregated_df", pd.DataFrame())
    player_gender_map = artifacts.get("player_gender_map", {})

    return {
        "teams": artifacts.get("teams", []),
        "teamsByGender": {
            "male": _teams_for_gender(
                filtered_df,
                "male",
                artifacts.get("team_to_players", {}),
                player_gender_map,
            ),
            "female": _teams_for_gender(
                filtered_df,
                "female",
                artifacts.get("team_to_players", {}),
                player_gender_map,
            ),
        },
        "players": artifacts.get("players", []),
        "playerCount": len(artifacts.get("players", [])),
        "teamCount": len(artifacts.get("teams", [])),
        "genderCounts": {
            "male": sum(1 for value in player_gender_map.values() if value == "male"),
            "female": sum(1 for value in player_gender_map.values() if value == "female"),
        },
        "artifactStatus": {
            "aggregatedRows": int(len(aggregated_df)),
            "filteredRows": int(len(filtered_df)),
            "bowlingRows": int(len(artifacts.get("bowling_over_df", pd.DataFrame()))),
            "bayesAvailable": artifacts.get("bayes_results") is not None,
        },
    }


def _team_candidates(team_filter: Optional[str], artifacts: dict[str, Any]) -> set[str]:
    if not team_filter:
        return set()

    team_to_players = artifacts.get("team_to_players", {})
    candidates = set(team_to_players.get(team_filter, set()))
    if candidates:
        return candidates

    filtered_df = artifacts.get("filtered_df", pd.DataFrame())
    if filtered_df.empty or "batting_team" not in filtered_df.columns or "batsman" not in filtered_df.columns:
        return set()

    rows = filtered_df[filtered_df["batting_team"] == team_filter]
    return set(rows["batsman"].dropna().astype(str).tolist())


def _build_batting_pool(
    artifacts: dict[str, Any],
    gender: str,
    team_filter: Optional[str],
) -> pd.DataFrame:
    agg_df = artifacts.get("aggregated_df", pd.DataFrame())
    if agg_df.empty:
        return agg_df

    pool = agg_df.copy()
    if "gender" in pool.columns:
        pool = pool[pool["gender"] == gender].copy()
    elif artifacts.get("player_gender_map"):
        gender_map = artifacts["player_gender_map"]
        pool = pool[pool["batsman"].map(gender_map).fillna("male") == gender].copy()

    if team_filter:
        team_players = _team_candidates(team_filter, artifacts)
        if team_players:
            pool = pool[pool["batsman"].isin(team_players)].copy()
        else:
            return pool.iloc[0:0].copy()

    return pool


def get_batting_recommendations(
    situation_label: str,
    innings_type: str,
    team_filter: Optional[str],
    gender: str,
    strategy: Optional[str],
    top_n: int,
) -> tuple[list[dict[str, Any]], Optional[str], str]:
    artifacts = load_t20_artifacts()
    from cricket_metrics import (
        compute_global_phase_averages,
        consistency_rating,
        generate_player_explanation,
        phase_dominance_index,
        pressure_performance_score,
        situation_suitability_score,
        suggest_players_numpyro,
    )

    pool = _build_batting_pool(artifacts, gender=gender, team_filter=team_filter)
    if pool.empty:
        label = "women's" if gender == "female" else "men's"
        if team_filter:
            return [], f"No {label} batting data was found for {team_filter}.", "empty"
        return [], f"No {label} batting data is available in the T20 artifact set.", "empty"

    context = "exact"
    sit_rows = pool[pool["situation_label"] == situation_label].copy()
    if sit_rows.empty:
        phase_prefix = f"{situation_label.split('|')[0]}|"
        sit_rows = pool[pool["situation_label"].str.startswith(phase_prefix)].copy()
        context = "phase"
    if sit_rows.empty:
        sit_rows = pool.copy()
        context = "global"

    player_stats = (
        sit_rows.groupby("batsman", dropna=False)
        .apply(
            lambda group: pd.Series({
                "avg_runs": _weighted_mean(group, "avg_runs_after_entry"),
                "dismiss_prob": _weighted_mean(group, "dismissal_probability"),
                "entry_count": pd.to_numeric(group.get("entry_count"), errors="coerce").fillna(0).sum(),
                "avg_sr": _weighted_mean(group, "avg_strike_rate_after_entry")
                if "avg_strike_rate_after_entry" in group.columns
                else None,
                "median_runs": _weighted_mean(group, "median_runs_after_entry")
                if "median_runs_after_entry" in group.columns
                else None,
            })
        )
        .reset_index()
        .sort_values(["avg_runs", "entry_count"], ascending=[False, False])
        .head(max(top_n * 6, 30))
    )

    phase = situation_label.split("|")[0]
    phase_avgs = compute_global_phase_averages(pool if not pool.empty else artifacts["aggregated_df"])
    global_phase_avg = float(phase_avgs.get(phase, 20.0))
    global_sr_prior = (
        _weighted_mean(sit_rows if not sit_rows.empty else pool, "avg_strike_rate_after_entry")
        or 110.0
    )
    peer_exp_avg = float(player_stats["avg_runs"].mean()) if not player_stats.empty else 20.0

    bayes_lookup: dict[str, dict[str, Any]] = {}
    bayes_results = artifacts.get("bayes_results")
    if bayes_results is not None:
        try:
            bayes_df = suggest_players_numpyro(
                bayes_results,
                situation_label=situation_label,
                innings_type=innings_type,
                strategy=_normalize_strategy(strategy, innings_type),
                top_n=max(top_n * 20, 120),
            )
            if bayes_df is not None and not bayes_df.empty:
                bayes_df = bayes_df.reset_index()
                player_col = "batsman" if "batsman" in bayes_df.columns else bayes_df.columns[0]
                bayes_df[player_col] = bayes_df[player_col].astype(str)
                bayes_df = bayes_df[bayes_df[player_col].isin(player_stats["batsman"].astype(str))]
                bayes_lookup = {
                    str(row[player_col]): row
                    for _, row in bayes_df.to_dict(orient="index").items()
                }
        except Exception:
            bayes_lookup = {}

    recs: list[dict[str, Any]] = []
    player_to_team = artifacts.get("player_to_team", {})
    player_image_urls = artifacts.get("player_image_urls", {})
    overall_agg = artifacts.get("aggregated_df", pd.DataFrame())
    dismissal_metrics_reliable = bool(artifacts.get("dismissal_metrics_reliable"))
    global_dismissal_rate = float(artifacts.get("global_dismissal_rate", 0.25))

    for _, row in player_stats.iterrows():
        batsman = str(row["batsman"])
        model_row = bayes_lookup.get(batsman, {})

        entry_count = int(_clean_number(row.get("entry_count")) or 0)
        if entry_count < 2:
            continue

        observed_avg_runs = _clean_number(row.get("avg_runs")) or global_phase_avg
        model_exp_runs = _clean_number(model_row.get("exp_runs"))
        exp_runs = model_exp_runs if model_exp_runs is not None else _shrink_mean(
            observed_avg_runs,
            entry_count,
            global_phase_avg,
            10.0 if context == "exact" else 14.0,
        )
        if exp_runs is None:
            exp_runs = global_phase_avg

        sit_sr = _shrink_mean(
            _clean_number(row.get("avg_sr")),
            entry_count,
            global_sr_prior,
            10.0,
        ) or 0.0
        p_out = _clean_number(model_row.get("p_out"))
        dismissal_warning = None
        if p_out is None and dismissal_metrics_reliable:
            p_out = _shrink_rate(
                _clean_number(row.get("dismiss_prob")),
                entry_count,
                global_dismissal_rate,
                12.0,
            )
        if p_out is None:
            p_out = global_dismissal_rate
            dismissal_warning = (
                "Dismissal artifacts are incomplete right now, so a conservative population prior is being used."
            )

        player_rows = overall_agg[overall_agg["batsman"] == batsman]
        sd_runs = _clean_number(model_row.get("sd_runs"))
        if sd_runs is None:
            sd_runs = _clean_number(player_rows.get("runs_std").mean() if "runs_std" in player_rows else None)
        if sd_runs is None or sd_runs < 0.1:
            sd_runs = max(4.0, exp_runs * 0.5)

        phase_rows = (
            player_rows[player_rows["situation_label"].str.startswith(phase)]
            if not player_rows.empty
            else pd.DataFrame()
        )
        phase_entry_count = int(
            pd.to_numeric(phase_rows.get("entry_count"), errors="coerce").fillna(0).sum()
        ) if not phase_rows.empty and "entry_count" in phase_rows.columns else 0
        player_phase_avg = (
            _weighted_mean(phase_rows, "avg_runs_after_entry")
            if not phase_rows.empty
            else global_phase_avg
        )
        if player_phase_avg is None:
            player_phase_avg = global_phase_avg
        player_phase_avg = _shrink_mean(player_phase_avg, phase_entry_count, global_phase_avg, 8.0) or global_phase_avg

        phase_dominance = phase_dominance_index(player_phase_avg, global_phase_avg)
        consistency = consistency_rating(exp_runs, sd_runs)
        player_total_entries = int(
            pd.to_numeric(player_rows.get("entry_count"), errors="coerce").fillna(0).sum()
        ) if not player_rows.empty and "entry_count" in player_rows.columns else entry_count
        pressure_score = pressure_performance_score(overall_agg, batsman)
        pressure_score = _shrink_mean(pressure_score, player_total_entries, 1.0, 12.0) or 1.0
        suitability = situation_suitability_score(
            exp_runs,
            sd_runs,
            p_out,
            phase_dominance,
            consistency,
            pressure_score,
            strategy=_normalize_strategy(strategy, innings_type),
        )

        reasons = generate_player_explanation(
            player_name=batsman,
            exp_runs=exp_runs,
            sd_runs=sd_runs,
            p_out=p_out,
            entry_count=entry_count,
            phase_dominance=phase_dominance,
            consistency=consistency,
            pressure_score=pressure_score,
            situation_label=situation_label,
            strategy=strategy or "balanced",
            peer_exp_avg=peer_exp_avg,
        )
        support_warning = dismissal_warning or _sample_warning(
            entry_count,
            medium=8,
            high=20,
            noun="entries",
        )
        support = _metric_support(
            entry_count,
            medium=8,
            high=20,
            warning=support_warning,
            uncertainty=_predictive_interval(
                exp_runs,
                sd_runs,
                label="80% xRuns range",
            ),
        )

        recs.append(
            {
                "player": batsman,
                "team": player_to_team.get(batsman, team_filter or ""),
                "imageUrl": player_image_urls.get(batsman),
                "expRuns": round(exp_runs, 1),
                "sdRuns": round(sd_runs, 1),
                "situationStrikeRate": round(sit_sr, 1),
                "dismissalProbability": round(p_out, 3),
                "entryCount": entry_count,
                "phaseDominance": round(phase_dominance, 2),
                "consistency": round(consistency, 2),
                "pressureScore": round(pressure_score, 2),
                "situationSuitability": round(suitability, 1),
                "modelScore": _clean_number(model_row.get("score")),
                "phase": phase,
                "reasons": reasons,
                "support": support,
            }
        )

    recs.sort(
        key=lambda item: (
            float(item["situationSuitability"]),
            float(item["expRuns"]),
            float(item["entryCount"]),
        ),
        reverse=True,
    )
    return recs[:top_n], None, context


def get_bowling_recommendations(
    situation_label: str,
    innings_mode: str,
    team_filter: Optional[str],
    gender: str,
    top_n: int,
) -> tuple[list[dict[str, Any]], str]:
    artifacts = load_t20_artifacts()
    over_df = artifacts.get("bowling_over_df", pd.DataFrame())
    if over_df.empty:
        return [], "empty"

    work = over_df.copy()
    if "gender" in work.columns:
        work = work[work["gender"] == gender].copy()
    if "innings_mode" in work.columns:
        work = work[work["innings_mode"] == innings_mode].copy()
    if team_filter and "bowling_team" in work.columns:
        team_rows = work[work["bowling_team"] == team_filter].copy()
        if not team_rows.empty:
            work = team_rows

    context = "exact"
    situation_rows = work[work["situation_label"] == situation_label].copy()
    if len(situation_rows) < max(top_n, 6):
        overs_prefix = f"{situation_label.split('|')[0]}|"
        situation_rows = work[work["situation_label"].str.startswith(overs_prefix)].copy()
        context = "phase"
    if situation_rows.empty:
        situation_rows = work.copy()
        context = "global"
    if situation_rows.empty:
        return [], "empty"

    pooled_balls = max(1, int(situation_rows["balls_in_over"].fillna(0).sum()))
    pooled_wickets = int(situation_rows["wickets_in_over"].fillna(0).sum())
    pooled_runs = float(situation_rows["runs_in_over"].fillna(0).sum())

    global_p_wicket = (pooled_wickets + 1.0) / (pooled_balls + 2.0)
    global_run_rate = (pooled_runs + 1.0) / (pooled_balls + 1.0)

    prior_strength_wicket = 12.0
    alpha0_wicket = global_p_wicket * prior_strength_wicket
    beta0_wicket = (1.0 - global_p_wicket) * prior_strength_wicket
    alpha0_runs = 6.0 * global_run_rate
    beta0_runs = 6.0

    overs_band, runs_band, wickets_band, _ = situation_label.split("|")
    containment_weight = {
        "0-40": 0.20,
        "41-80": 0.30,
        "81-120": 0.40,
        "121+": 0.50,
    }.get(runs_band, 0.30)
    wicket_weight = {
        "0-5": 1.00,
        "6-10": 0.90,
        "11-15": 0.80,
        "16-20": 0.70,
    }.get(overs_band, 0.85)

    grouped = (
        situation_rows.groupby(["bowler", "bowling_team"], dropna=False)
        .agg(
            balls=("balls_in_over", "sum"),
            runs=("runs_in_over", "sum"),
            wickets=("wickets_in_over", "sum"),
            oversSample=("wickets_in_over", "size"),
            wicketsStd=("wickets_in_over", "std"),
            runsStd=("runs_in_over", "std"),
        )
        .reset_index()
    )

    recommendations: list[dict[str, Any]] = []
    for _, row in grouped.iterrows():
        balls = int(_clean_number(row.get("balls")) or 0)
        if balls < 12:
            continue

        wickets = int(_clean_number(row.get("wickets")) or 0)
        runs = _clean_number(row.get("runs")) or 0.0
        overs_sample = int(_clean_number(row.get("oversSample")) or 0)

        alpha_w = alpha0_wicket + wickets
        beta_w = beta0_wicket + max(0, balls - wickets)
        wicket_prob = alpha_w / (alpha_w + beta_w)
        exp_wickets_per_over = 6.0 * wicket_prob
        var_wicket_prob = (alpha_w * beta_w) / (
            ((alpha_w + beta_w) ** 2) * (alpha_w + beta_w + 1.0)
        )
        sd_wickets_per_over = 6.0 * math.sqrt(max(var_wicket_prob, 0.0))

        alpha_r = alpha0_runs + runs
        beta_r = beta0_runs + balls
        run_lambda = alpha_r / beta_r
        exp_runs_per_over = 6.0 * run_lambda
        sd_runs_per_over = 6.0 * math.sqrt(alpha_r) / beta_r

        utility = wicket_weight * exp_wickets_per_over - containment_weight * exp_runs_per_over
        support = _metric_support(
            overs_sample,
            medium=4,
            high=10,
            warning=_sample_warning(
                overs_sample,
                medium=4,
                high=10,
                noun="overs",
            ),
            uncertainty=_predictive_interval(
                exp_runs_per_over,
                sd_runs_per_over,
                label="80% xRuns/ov range",
            ),
        )
        reasons = [
            f"{exp_wickets_per_over:.2f} expected wickets per over in comparable spells.",
            f"{exp_runs_per_over:.1f} expected runs conceded per over from {overs_sample} similar overs.",
            f"{overs_band} overs with {wickets_band} wickets down puts a premium on {'control' if containment_weight >= 0.4 else 'strike bowling'}.",
        ]

        recommendations.append(
            {
                "player": str(row.get("bowler", "")),
                "team": str(row.get("bowling_team", "") or ""),
                "expectedWickets": round(exp_wickets_per_over, 2),
                "expectedRunsConceded": round(exp_runs_per_over, 1),
                "wicketsStd": round(sd_wickets_per_over, 2),
                "runsStd": round(sd_runs_per_over, 2),
                "utilityScore": round(utility, 3),
                "oversSample": overs_sample,
                "reasons": reasons,
                "support": support,
            }
        )

    recommendations.sort(
        key=lambda item: (
            float(item["utilityScore"]),
            float(item["expectedWickets"]),
            -float(item["expectedRunsConceded"]),
        ),
        reverse=True,
    )

    return recommendations[:top_n], context


def get_manual_advisor(
    runs: int,
    wickets: int,
    overs: float,
    innings: int,
    target: Optional[int],
    batting_team: Optional[str],
    bowling_team: Optional[str],
    match_gender: Optional[str],
    strategy: Optional[str],
    top_n: int,
) -> dict[str, Any]:
    gender = _normalize_gender(match_gender)
    top_n = max(3, min(10, int(top_n)))

    batting_label, innings_type, required_rr, current_rr = build_batting_situation_label(
        over=overs,
        runs=int(runs),
        wickets=int(wickets),
        innings=int(innings),
        target=target,
    )
    bowling_label, innings_mode = build_bowling_situation_label(
        over=overs,
        runs=int(runs),
        wickets=int(wickets),
        innings=int(innings),
    )

    batting_recommendations, batting_error, batting_context = get_batting_recommendations(
        situation_label=batting_label,
        innings_type=innings_type,
        team_filter=batting_team or None,
        gender=gender,
        strategy=strategy,
        top_n=top_n,
    )
    bowling_recommendations, bowling_context = get_bowling_recommendations(
        situation_label=bowling_label,
        innings_mode=innings_mode,
        team_filter=bowling_team or None,
        gender=gender,
        top_n=top_n,
    )

    warnings: list[str] = []
    if batting_error:
        warnings.append(batting_error)
    if not bowling_recommendations:
        warnings.append("Bowling recommendations were unavailable for the selected context.")

    raw_display = f"{runs}/{wickets} ({_balls_to_over_string(overs)} ov)"
    if innings == 2 and target is not None:
        raw_display += f" | Target {target}"

    return {
        "situation": {
            "battingLabel": batting_label,
            "bowlingLabel": bowling_label,
            "inningsType": innings_type,
            "inningsMode": innings_mode,
            "requiredRunRate": round(required_rr, 2) if required_rr is not None else None,
            "currentRunRate": current_rr,
            "rawDisplay": raw_display,
            "battingTeam": batting_team,
            "bowlingTeam": bowling_team,
            "over": overs,
            "runs": runs,
            "wickets": wickets,
            "target": target,
            "matchGender": gender,
            "battingContext": batting_context,
            "bowlingContext": bowling_context,
        },
        "battingRecommendations": batting_recommendations,
        "bowlingRecommendations": bowling_recommendations,
        "warnings": warnings,
    }


@lru_cache(maxsize=4)
def get_evaluation(sample_situations: int = 80) -> dict[str, Any]:
    artifacts = load_t20_artifacts()
    evaluation = artifacts.get("eval_results")

    has_cached_metrics = bool(
        evaluation is not None and hasattr(evaluation, "top1_accuracy")
    )

    if not has_cached_metrics:
        from evaluator import run_backtesting

        evaluation = run_backtesting(
            artifacts["entries_with_perf"],
            artifacts["aggregated_df"],
            artifacts["bayes_results"],
            sample_situations=sample_situations,
        )

    calibration_df = getattr(evaluation, "calibration_df", pd.DataFrame())
    backtest_df = getattr(evaluation, "backtest_df", pd.DataFrame())

    if not calibration_df.empty:
        calibration_df = calibration_df.copy()
        calibration_df["calibrationGap"] = (
            calibration_df["mean_predicted"] - calibration_df["mean_actual"]
        )
        calibration_df["absoluteCalibrationGap"] = calibration_df["calibrationGap"].abs()
        calibration_df = calibration_df.sort_values("absoluteCalibrationGap", ascending=False)

    if not backtest_df.empty:
        backtest_df = backtest_df.copy()
        backtest_df["rank_of_best"] = pd.to_numeric(
            backtest_df["rank_of_best"], errors="coerce"
        )
        backtest_df = backtest_df.sort_values(
            ["p1_hit", "p3_hit", "rank_of_best"],
            ascending=[True, True, False],
        )

    covered_situations = int(len(backtest_df)) if not backtest_df.empty else 0
    attempted_situations = int(
        round(covered_situations / max(float(getattr(evaluation, "coverage", 0.0)), 1e-6))
    ) if covered_situations > 0 and float(getattr(evaluation, "coverage", 0.0)) > 0 else covered_situations
    top1_hits = int(pd.to_numeric(backtest_df.get("p1_hit"), errors="coerce").fillna(False).astype(bool).sum()) if not backtest_df.empty else 0
    top3_hits = int(pd.to_numeric(backtest_df.get("p3_hit"), errors="coerce").fillna(False).astype(bool).sum()) if not backtest_df.empty else 0
    evaluation_warning = _sample_warning(
        covered_situations,
        medium=25,
        high=60,
        noun="evaluated situations",
    )

    return {
        "summary": {
            "top1Accuracy": round(float(getattr(evaluation, "top1_accuracy", 0.0)) * 100, 1),
            "top3Accuracy": round(float(getattr(evaluation, "top3_accuracy", 0.0)) * 100, 1),
            "coverage": round(float(getattr(evaluation, "coverage", 0.0)) * 100, 1),
            "meanRankOfActualBest": round(
                float(getattr(evaluation, "mean_rank_of_actual_best", 0.0)),
                2,
            ),
            "improvementPct": round(float(getattr(evaluation, "improvement_pct", 0.0)), 2),
            "bayesMeanRuns": round(float(getattr(evaluation, "bayes_mean_runs", 0.0)), 2),
            "baselineMeanRuns": round(float(getattr(evaluation, "baseline_mean_runs", 0.0)), 2),
            "sampleSituations": attempted_situations or int(sample_situations),
            "cached": has_cached_metrics,
            "top1Interval": _wilson_interval(top1_hits, covered_situations),
            "top3Interval": _wilson_interval(top3_hits, covered_situations),
            "coverageInterval": _wilson_interval(covered_situations, attempted_situations) if attempted_situations > 0 else None,
            "confidenceTier": _confidence_tier(covered_situations, medium=25, high=60),
            "warning": evaluation_warning,
        },
        "calibration": _serialize_records(calibration_df, limit=40),
        "situations": _serialize_records(backtest_df, limit=80),
    }


def search_players(
    query: Optional[str] = None,
    team: Optional[str] = None,
    gender: Optional[str] = None,
    limit: int = 50,
) -> list[str]:
    artifacts = load_t20_artifacts()
    players = artifacts.get("players", [])
    if not players:
        return []

    matches = players
    if gender:
        normalized_gender = _normalize_gender(gender)
        gender_map = artifacts.get("player_gender_map", {})
        matches = [player for player in matches if gender_map.get(player, "male") == normalized_gender]

    if team:
        team_players = _team_candidates(team, artifacts)
        if team_players:
            matches = [player for player in matches if player in team_players]

    if query:
        ranked_matches = []
        for index, player in enumerate(matches):
            rank = _player_query_rank(player, query)
            if rank is None:
                continue
            ranked_matches.append((rank, index, player))

        ranked_matches.sort(key=lambda item: (item[0], item[1]))
        matches = [player for _, _, player in ranked_matches]

    return matches[: max(1, min(int(limit), 100))]


def get_player_explorer(player_name: str) -> dict[str, Any]:
    artifacts = load_t20_artifacts()
    aggregated_df = artifacts.get("aggregated_df", pd.DataFrame())
    entries_with_perf = artifacts.get("entries_with_perf", pd.DataFrame())
    dismissal_metrics_reliable = bool(artifacts.get("dismissal_metrics_reliable"))

    if aggregated_df.empty or "batsman" not in aggregated_df.columns:
        raise ValueError("Player explorer data is unavailable.")

    canonical_player_name = player_name
    player_rows = aggregated_df[aggregated_df["batsman"] == canonical_player_name].copy()
    if player_rows.empty:
        matches = search_players(query=player_name, limit=1)
        if not matches:
            raise ValueError(f"No situation profile was found for {player_name}.")
        canonical_player_name = matches[0]
        player_rows = aggregated_df[aggregated_df["batsman"] == canonical_player_name].copy()

    pdi_by_phase: dict[str, Optional[float]] = {}
    phase_entry_counts: dict[str, int] = {}
    phase_support: dict[str, dict[str, Any]] = {}
    from cricket_metrics import compute_global_phase_averages

    global_phase_avgs = compute_global_phase_averages(aggregated_df)
    global_runs_prior = _weighted_mean(aggregated_df, "avg_runs_after_entry") or 20.0
    global_sr_prior = _weighted_mean(aggregated_df, "avg_strike_rate_after_entry") or 110.0
    for phase in ("Powerplay", "Middle", "Death"):
        phase_rows = player_rows[player_rows["situation_label"].str.startswith(phase)]
        phase_entry_counts[phase] = int(
            pd.to_numeric(phase_rows.get("entry_count"), errors="coerce").fillna(0).sum()
        ) if "entry_count" in phase_rows.columns else int(len(phase_rows))
        if phase_rows.empty:
            pdi_by_phase[phase] = None
            continue
        player_phase_avg = _weighted_mean(phase_rows, "avg_runs_after_entry")
        if player_phase_avg is None:
            pdi_by_phase[phase] = None
            continue
        global_phase_avg = float(global_phase_avgs.get(phase, player_phase_avg or 1.0))
        shrunk_phase_avg = _shrink_mean(
            player_phase_avg,
            phase_entry_counts[phase],
            global_phase_avg,
            8.0,
        )
        pdi_by_phase[phase] = round(
            (shrunk_phase_avg or global_phase_avg) / global_phase_avg,
            2,
        ) if global_phase_avg else None
        phase_support[phase] = _metric_support(
            phase_entry_counts[phase],
            medium=5,
            high=15,
            warning=_sample_warning(
                phase_entry_counts[phase],
                medium=5,
                high=15,
                noun=f"{phase.lower()} entries",
            ),
        )

    strongest_phase_candidates = [
        (phase, score, phase_entry_counts.get(phase, 0))
        for phase, score in pdi_by_phase.items()
        if score is not None and phase_entry_counts.get(phase, 0) >= 5
    ]
    strongest_phase = (
        max(strongest_phase_candidates, key=lambda item: (item[1], item[2]))[0]
        if strongest_phase_candidates
        else None
    )

    entry_rows = (
        entries_with_perf[entries_with_perf["batsman"] == canonical_player_name].copy()
        if not entries_with_perf.empty and "batsman" in entries_with_perf.columns
        else pd.DataFrame()
    )
    dismissal_rate = None
    if dismissal_metrics_reliable and not entry_rows.empty and "dismissal_status" in entry_rows.columns:
        dismissed = _dismissal_status_mask(entry_rows["dismissal_status"])
        if not dismissed.empty:
            dismissal_rate = round(float(dismissed.mean()), 3)
    elif dismissal_metrics_reliable and "dismissal_probability" in player_rows.columns:
        dismissal_rate_value = _weighted_mean(player_rows, "dismissal_probability")
        dismissal_rate = round(float(dismissal_rate_value), 3) if dismissal_rate_value is not None else None

    avg_expected_runs_raw = _weighted_mean(player_rows, "avg_runs_after_entry")
    avg_situation_strike_rate_raw = _weighted_mean(player_rows, "avg_strike_rate_after_entry")
    total_entries = int(player_rows["entry_count"].sum()) if "entry_count" in player_rows.columns else 0
    avg_expected_runs = _shrink_mean(avg_expected_runs_raw, total_entries, global_runs_prior, 12.0)
    avg_situation_strike_rate = _shrink_mean(
        avg_situation_strike_rate_raw,
        total_entries,
        global_sr_prior,
        12.0,
    )
    player_runs_std = _weighted_mean(player_rows, "runs_std")
    summary_support = _metric_support(
        total_entries,
        medium=10,
        high=40,
        warning=_sample_warning(total_entries, medium=10, high=40, noun="entries"),
        uncertainty=_predictive_interval(
            avg_expected_runs,
            player_runs_std,
            label="80% xRuns range",
        ),
    )
    dismissal_support = (
        _metric_support(
            total_entries,
            medium=10,
            high=40,
            warning=None,
        )
        if dismissal_metrics_reliable
        else _metric_support(
            0,
            medium=10,
            high=40,
            warning="Dismissal metrics are suppressed because the artifact pipeline does not contain trustworthy wicket outcomes yet.",
        )
    )

    summary = {
        "player": canonical_player_name,
        "requestedPlayer": player_name,
        "team": artifacts.get("player_to_team", {}).get(canonical_player_name),
        "imageUrl": artifacts.get("player_image_urls", {}).get(canonical_player_name),
        "situations": int(len(player_rows)),
        "avgExpectedRuns": round(float(avg_expected_runs), 1) if avg_expected_runs is not None else 0.0,
        "totalEntries": total_entries,
        "dismissalRate": dismissal_rate,
        "avgSituationStrikeRate": round(float(avg_situation_strike_rate), 1) if avg_situation_strike_rate is not None else None,
        "strongestPhase": strongest_phase,
        "pdiByPhase": pdi_by_phase,
        "support": summary_support,
        "dismissalSupport": dismissal_support,
        "phaseSupport": phase_support,
    }

    profile_columns = [
        "situation_label",
        "innings_type",
        "entry_count",
        "avg_runs_after_entry",
        "median_runs_after_entry",
        "avg_strike_rate_after_entry",
        "dismissal_probability",
        "runs_std",
    ]
    available_columns = [column for column in profile_columns if column in player_rows.columns]
    profile_rows = player_rows[available_columns].copy()
    if not dismissal_metrics_reliable and "dismissal_probability" in profile_rows.columns:
        profile_rows["dismissal_probability"] = None
    if "avg_runs_after_entry" in profile_rows.columns:
        profile_rows["avg_runs_after_entry"] = profile_rows.apply(
            lambda row: _shrink_mean(
                _clean_number(row.get("avg_runs_after_entry")),
                int(_clean_number(row.get("entry_count")) or 0),
                global_runs_prior,
                8.0,
            ),
            axis=1,
        )
    profile_rows["support"] = profile_rows.apply(
        lambda row: _metric_support(
            int(_clean_number(row.get("entry_count")) or 0),
            medium=5,
            high=15,
            warning=_sample_warning(
                int(_clean_number(row.get("entry_count")) or 0),
                medium=5,
                high=15,
                noun="entries",
            ),
            uncertainty=_predictive_interval(
                _clean_number(row.get("avg_runs_after_entry")),
                _clean_number(row.get("runs_std")),
                label="80% xRuns range",
            ),
        ),
        axis=1,
    )
    profile_rows = profile_rows.sort_values(
        ["avg_runs_after_entry", "entry_count"],
        ascending=[False, False],
    )
    if "runs_std" in profile_rows.columns:
        profile_rows = profile_rows.drop(columns=["runs_std"])
    profile_rows = profile_rows.replace({np.nan: None})

    return {
        "summary": summary,
        "profiles": profile_rows.to_dict(orient="records"),
    }
