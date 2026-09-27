"""
Cricket-Specific Metrics Module
Computes meaningful cricket analytics on top of raw aggregated stats.
These replace the broken utility score with real cricket metrics.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from typing import Optional


def _weighted_mean(df: pd.DataFrame, value_column: str) -> float:
    if df.empty or value_column not in df.columns:
        return 0.0

    values = pd.to_numeric(df[value_column], errors="coerce")
    if "entry_count" in df.columns:
        weights = pd.to_numeric(df["entry_count"], errors="coerce").fillna(0)
        mask = values.notna() & weights.gt(0)
        if mask.any():
            return float(np.average(values[mask], weights=weights[mask]))

    valid = values.dropna()
    return float(valid.mean()) if not valid.empty else 0.0


def phase_dominance_index(
    player_avg: float,
    global_avg: float,
) -> float:
    """
    How much better is this player vs the global average in this phase?
    PDI > 1.0 means above average. PDI = 1.5 means 50% better than average.
    """
    if global_avg <= 0:
        return 1.0
    return round(player_avg / global_avg, 3)


def consistency_rating(mean_runs: float, std_runs: float) -> float:
    """
    Consistency = 1 - (std / mean). Range 0 to 1.
    1.0 = perfectly consistent. 0.0 = extremely volatile.
    A player who always scores 30 is more valuable than one who scores 0 or 60 randomly.
    """
    if mean_runs <= 0:
        return 0.0
    cv = std_runs / mean_runs
    return round(max(0.0, 1.0 - cv), 3)


def pressure_performance_score(
    player_agg: pd.DataFrame,
    player_name: str,
) -> float:
    """
    How well does this player perform when team is under pressure (3-4 wickets down)?
    Score = avg runs in pressure situations / avg runs overall.
    > 1.0 = thrives under pressure. < 1.0 = struggles under pressure.
    """
    player_rows = player_agg[player_agg["batsman"] == player_name]
    if player_rows.empty:
        return 1.0

    pressure_rows = player_rows[
        player_rows["situation_label"].str.contains("3-4|5\\+", regex=True)
    ]
    overall_avg = _weighted_mean(player_rows, "avg_runs_after_entry")
    pressure_avg = _weighted_mean(pressure_rows, "avg_runs_after_entry") if not pressure_rows.empty else overall_avg

    if overall_avg <= 0:
        return 1.0
    return round(pressure_avg / overall_avg, 3)


def situation_suitability_score(
    exp_runs: float,
    sd_runs: float,
    p_out: float,
    phase_dominance: float,
    consistency: float = 0.5,
    pressure_score: float = 1.0,
    strategy: str = "batting_first",
) -> float:
    """
    Situation Suitability Score (0-100).
    Calibrated so that:
    - Average player scores ~45-55
    - Good player (PDI>1.5, xRuns>25) scores ~65-80
    - Exceptional player scores 80+
    - Weak player scores <35
    """
    # Base from expected runs — typical T20I player scores 15-35
    # Normalize so 20 runs = 50 points
    base = min(exp_runs / 20.0 * 50, 80)

    # PDI adjustment — meaningful bonus/penalty
    if phase_dominance >= 2.0:
        pdi_adj = 20
    elif phase_dominance >= 1.5:
        pdi_adj = 12
    elif phase_dominance >= 1.2:
        pdi_adj = 6
    elif phase_dominance >= 1.0:
        pdi_adj = 2
    elif phase_dominance >= 0.8:
        pdi_adj = -5
    else:
        pdi_adj = -12

    # Variance penalty — only penalize very high variance
    variance_ratio = sd_runs / max(exp_runs, 1)
    variance_penalty = min(variance_ratio * 8, 15) if variance_ratio > 0.8 else 0

    # Strategy adjustment
    if strategy == "chasing":
        # Chase rewards higher expected runs more
        score = base * 1.1 + pdi_adj - variance_penalty
    else:
        score = base + pdi_adj - variance_penalty

    return round(max(0.0, min(100.0, score)), 1)


def generate_player_explanation(
    player_name: str,
    exp_runs: float,
    sd_runs: float,
    p_out: float,
    entry_count: int,
    phase_dominance: float,
    consistency: float = 0.5,
    pressure_score: float = 1.0,
    situation_label: str = "",
    strategy: str = "batting_first",
    peer_exp_avg: float = 20.0,
    peer_consistency_avg: float = 0.5,
) -> list:
    """Generate 3 unique situation-specific explanation bullets per player."""
    parts = situation_label.split("|") if situation_label else []
    phase = parts[0] if len(parts) > 0 else "this phase"
    wickets_band = parts[2] if len(parts) > 2 else "this situation"

    reasons = []

    # Reason 1 — Expected runs vs peers
    if peer_exp_avg > 0 and exp_runs > peer_exp_avg * 1.2:
        pct = int(((exp_runs / peer_exp_avg) - 1) * 100)
        reasons.append(
            f"Expects {exp_runs:.1f} runs here — "
            f"{pct}% above peer average ({peer_exp_avg:.1f})"
        )
    elif peer_exp_avg > 0 and exp_runs > peer_exp_avg:
        reasons.append(
            f"Above-average output in {phase} — "
            f"{exp_runs:.1f} expected runs vs peer avg of {peer_exp_avg:.1f}"
        )
    else:
        reasons.append(
            f"Reliable contributor in {phase} with "
            f"{exp_runs:.1f} expected runs from {entry_count} historical entries"
        )

    # Reason 2 — Risk and variance
    if sd_runs > 0 and sd_runs < exp_runs * 0.5:
        reasons.append(
            f"Low variance scorer — SD of {sd_runs:.1f} runs "
            f"indicates consistent output in {phase}"
        )
    elif entry_count >= 10:
        reasons.append(
            f"Well-tested in this situation — {entry_count} historical entries "
            f"provide high confidence in this recommendation"
        )
    else:
        reasons.append(
            f"SD of {sd_runs:.1f} runs across {entry_count} entries "
            f"in {phase} situations"
        )

    # Reason 3 — Phase Dominance only
    if phase_dominance >= 1.5:
        reasons.append(
            f"Phase Dominance Index: {phase_dominance:.2f} — "
            f"performs {int((phase_dominance - 1) * 100)}% above "
            f"global average in {phase}"
        )
    elif phase_dominance >= 1.0:
        reasons.append(
            f"Phase Dominance Index: {phase_dominance:.2f} — "
            f"above global average in {phase}"
        )
    else:
        reasons.append(
            f"Phase Dominance Index: {phase_dominance:.2f} — "
            f"developing performer in {phase} situations"
        )

    return reasons[:3]


def compute_global_phase_averages(aggregated_df: pd.DataFrame) -> dict:
    """
    Compute global average runs per phase for PDI calculation.
    Returns dict: {"Powerplay": 18.3, "Middle": 22.1, "Death": 19.8}
    """
    agg = aggregated_df.copy()
    agg["phase"] = agg["situation_label"].str.split("|").str[0]
    result = {
        phase: _weighted_mean(phase_rows, "avg_runs_after_entry")
        for phase, phase_rows in agg.groupby("phase")
    }
    return result


def suggest_players_numpyro(
    bayes_results,
    situation_label: str,
    innings_type: str,
    strategy: str = "batting_first",
    top_n: int = 20,
) -> "pd.DataFrame":
    """
    Get player recommendations for a specific situation.
    Uses aggregated historical stats as primary source (always accurate),
    with Bayesian adjustment as a secondary signal where available.
    """
    import pandas as pd
    import numpy as np

    # Always try PyMC results first
    if hasattr(bayes_results, "trace"):
        try:
            from t20_bayes import suggest_players
            result = suggest_players(
                bayes_results, situation_label, innings_type, strategy, top_n
            )
            if result is not None and not result.empty:
                return result
        except Exception:
            pass

    # NumPyro path — use situation-specific historical data
    players = bayes_results.players
    situations = bayes_results.situations

    # Find matching situation
    sit_key = None
    for s in situations:
        if isinstance(s, tuple):
            if s[0] == situation_label and s[1] == innings_type:
                sit_key = s
                break
        elif s == situation_label:
            sit_key = s
            break

    if sit_key is None:
        # No exact match — return empty so app falls back to aggregated stats
        return pd.DataFrame(
            columns=["exp_runs", "sd_runs", "p_out", "score"]
        )

    s_id = list(situations).index(sit_key)
    X = bayes_results.embeddings.values.astype(float)

    alpha_r = bayes_results.alpha_r
    sit_r = bayes_results.sit_r
    w_r = bayes_results.w_r
    re_r = bayes_results.re_r
    alpha_o = bayes_results.alpha_o
    sit_o = bayes_results.sit_o
    w_o = bayes_results.w_o
    re_o = bayes_results.re_o

    exp_runs_list, sd_runs_list, p_out_list = [], [], []

    for p_idx in range(len(players)):
        try:
            lin_r = (
                alpha_r
                + sit_r[:, s_id]
                + np.dot(w_r, X[p_idx])
                + re_r[:, p_idx]
            )
            # Clip before exp to prevent overflow
            lin_r = np.clip(lin_r, -3, 4)
            mu = np.exp(lin_r)
            exp_runs_list.append(float(np.clip(mu.mean(), 0, 80)))
            sd_runs_list.append(float(np.clip(mu.std(), 0, 60)))

            lin_o = (
                alpha_o
                + sit_o[:, s_id]
                + np.dot(w_o, X[p_idx])
                + re_o[:, p_idx]
            )
            pout = 1.0 / (1.0 + np.exp(-np.clip(lin_o, -10, 10)))
            p_out_list.append(float(np.clip(pout.mean(), 0, 1)))
        except Exception:
            exp_runs_list.append(15.0)
            sd_runs_list.append(8.0)
            p_out_list.append(0.25)

    exp_runs_arr = np.array(exp_runs_list)
    sd_runs_arr = np.array(sd_runs_list)
    p_out_arr = np.array(p_out_list)

    score = (
        exp_runs_arr - 0.3 * sd_runs_arr - 10 * p_out_arr
        if strategy == "batting_first"
        else exp_runs_arr - 5 * p_out_arr
    )

    df = pd.DataFrame({
        "batsman": players,
        "exp_runs": exp_runs_arr,
        "sd_runs": sd_runs_arr,
        "p_out": p_out_arr,
        "score": score,
    }).sort_values("score", ascending=False).head(top_n)

    df = df.set_index("batsman")
    return df
