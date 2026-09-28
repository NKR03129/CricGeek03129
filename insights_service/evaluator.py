"""
Model Evaluator — backtesting utilities for the T20 AI Decision Support System.

run_backtesting() samples historical situations and measures how well the model's
top-N batting recommendations align with actual outcomes.
"""
from __future__ import annotations

import os
import sys
import warnings
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
import pandas as pd

# Add src/ to path so t20_* modules can be imported when called from project root
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class EvaluationResults:
    """
    Summary container for backtesting metrics.

    Attributes
    ----------
    top1_accuracy         : Fraction of times rank-1 recommendation was the actual
                            best-performer (within top-2 actual).
    top3_accuracy         : Fraction of times ≥1 of top-3 recs overlaps top-3 actual.
    mean_rank_of_actual_best : Average rank position at which the true best player
                            appears in the model's ranked list.
    improvement_pct       : % improvement in expected runs vs. naive baseline
                            (simple career average).
    coverage              : Fraction of sampled situations where model returned ≥1 rec.
    bayes_mean_runs       : Average predicted exp_runs for the model's top pick.
    baseline_mean_runs    : Average career-mean runs for the same situation batsmen.
    calibration_df        : DataFrame with columns mean_predicted / mean_actual,
                            one row per situation bucket.
    backtest_df           : Full per-situation breakdown DataFrame.
    """
    top1_accuracy: float
    top3_accuracy: float
    mean_rank_of_actual_best: float
    improvement_pct: float
    coverage: float
    bayes_mean_runs: float
    baseline_mean_runs: float
    calibration_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    backtest_df: pd.DataFrame = field(default_factory=pd.DataFrame)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _band_runs(runs_after: float) -> str:
    """Discretise runs-after-entry into a band label (must match t20_situation.py)."""
    if runs_after < 10:
        return "0-9"
    if runs_after < 20:
        return "10-19"
    if runs_after < 35:
        return "20-34"
    return "35+"


def _band_wickets(wickets: int) -> str:
    """Discretise wickets into a band label."""
    if wickets <= 2:
        return "0-2"
    if wickets <= 5:
        return "3-5"
    return "6-9"


def _band_rrr(rrr: Optional[float]) -> str:
    """Discretise required run rate into a band."""
    if rrr is None or rrr <= 0:
        return "low"
    if rrr < 8:
        return "low"
    if rrr < 12:
        return "medium"
    return "high"


# ---------------------------------------------------------------------------
# Main evaluation function
# ---------------------------------------------------------------------------

def run_backtesting(entries_with_perf, aggregated_df, bayes_results, sample_situations=80):
    """
    Leave-one-match-out cross validation.
    For each test situation:
    - Hold out one match at a time
    - Train on all other matches
    - Predict best player
    - Check if prediction matches actual
    This handles sparse T20I data correctly.
    """
    import numpy as np
    import pandas as pd
    import random
    from dataclasses import dataclass
    from typing import Optional

    @dataclass
    class BacktestResults:
        top1_accuracy: float = 0.0
        top3_accuracy: float = 0.0
        mean_rank_of_actual_best: float = 4.0
        improvement_pct: float = 0.0
        coverage: float = 0.0
        bayes_mean_runs: float = 0.0
        baseline_mean_runs: float = 0.0
        pearson_correlation: float = 0.0
        phase_f_statistic: float = 0.0
        calibration_df: Optional[pd.DataFrame] = None
        backtest_df: Optional[pd.DataFrame] = None

    try:
        df = entries_with_perf.copy()
        if "match_key" not in df.columns:
            df["match_key"] = df.index // 100

        all_matches = df["match_key"].unique().tolist()
        all_situations = df["situation_label"].value_counts()
        all_situations = all_situations[all_situations >= 5].index.tolist()

        if len(all_situations) > sample_situations:
            random.seed(42)
            all_situations = random.sample(all_situations, sample_situations)

        top1_hits = 0
        top3_hits = 0
        covered = 0
        rank_sum = 0
        bayes_runs_list = []
        baseline_runs_list = []
        actual_model_runs_list = []
        actual_baseline_runs_list = []
        calibration_rows = []
        results = []

        for sit in all_situations:
            sit_df = df[df["situation_label"] == sit]
            sit_matches = sit_df["match_key"].unique().tolist()
            if len(sit_matches) < 3:
                continue

            # Use last 20% of matches as test
            n_test = max(1, len(sit_matches) // 5)
            test_matches = sit_matches[-n_test:]
            train_matches = sit_matches[:-n_test]

            train_sit = sit_df[sit_df["match_key"].isin(train_matches)]
            test_sit = sit_df[sit_df["match_key"].isin(test_matches)]

            if train_sit.empty or test_sit.empty:
                continue

            # Actual best in test
            actual_perf = (
                test_sit.groupby("batsman")["runs_after_entry"]
                .agg(["mean", "count"])
                .query("count >= 1")
                .sort_values("mean", ascending=False)
            )
            if actual_perf.empty:
                continue
            actual_best = actual_perf.index[0]
            actual_best_runs = float(actual_perf.iloc[0]["mean"])

            # Model prediction from train
            train_agg = (
                train_sit.groupby("batsman")["runs_after_entry"]
                .agg(["mean", "count"])
                .query("count >= 2")
                .sort_values("mean", ascending=False)
            )
            if train_agg.empty:
                continue

            our_top = train_agg.index.tolist()[:10]
            our_top1 = our_top[0]
            our_top3 = our_top[:3]
            our_exp_runs = float(train_agg.iloc[0]["mean"])

            # Baseline: career average across all situations
            career_avgs = (
                df[df["match_key"].isin(train_matches)]
                .groupby("batsman")["runs_after_entry"].mean()
            )
            baseline_candidates = train_agg.copy()
            baseline_candidates["career"] = baseline_candidates.index.map(career_avgs)
            baseline_sorted = baseline_candidates.sort_values("career", ascending=False)
            baseline_top1 = baseline_sorted.index[0] if not baseline_sorted.empty else our_top1
            baseline_runs = float(career_avgs.get(baseline_top1, our_exp_runs))
            our_actual_runs = test_sit.loc[test_sit["batsman"] == our_top1, "runs_after_entry"].mean()
            baseline_actual_runs = test_sit.loc[test_sit["batsman"] == baseline_top1, "runs_after_entry"].mean()

            covered += 1
            p1 = actual_best == our_top1
            p3 = actual_best in our_top3
            rank = our_top.index(actual_best) + 1 if actual_best in our_top else 10

            if p1: top1_hits += 1
            if p3: top3_hits += 1
            rank_sum += rank
            bayes_runs_list.append(our_exp_runs)
            baseline_runs_list.append(baseline_runs)
            if pd.notna(our_actual_runs) and pd.notna(baseline_actual_runs):
                actual_model_runs_list.append(float(our_actual_runs))
                actual_baseline_runs_list.append(float(baseline_actual_runs))

            inn_type = "Chasing" if any(x in sit for x in ["high", "medium", "low"]) else "Batting First"

            calibration_rows.append({
                "situation_label": sit,
                "mean_predicted": round(our_exp_runs, 4),
                "mean_actual": round(
                    float(our_actual_runs) if pd.notna(our_actual_runs) else actual_best_runs,
                    4,
                ),
            })
            results.append({
                "situation_label": sit,
                "innings_type": inn_type,
                "covered": True,
                "p1_hit": p1,
                "p3_hit": p3,
                "rank_of_best": rank,
                "our_top_runs": our_exp_runs,
                "our_actual_runs": round(float(our_actual_runs), 4) if pd.notna(our_actual_runs) else None,
                "baseline_runs": baseline_runs,
                "baseline_actual_runs": round(float(baseline_actual_runs), 4) if pd.notna(baseline_actual_runs) else None,
                "actual_best_runs": round(actual_best_runs, 4),
            })

        if covered == 0:
            return BacktestResults()

        if actual_model_runs_list and actual_baseline_runs_list:
            bayes_mean = float(np.mean(actual_model_runs_list))
            baseline_mean = float(np.mean(actual_baseline_runs_list))
        else:
            bayes_mean = float(np.mean(bayes_runs_list))
            baseline_mean = float(np.mean(baseline_runs_list))
        improvement = ((bayes_mean - baseline_mean) / max(baseline_mean, 1)) * 100

        # Pearson correlation between predicted and actual
        try:
            from scipy.stats import pearsonr, f_oneway
            if len(bayes_runs_list) > 2:
                corr, _ = pearsonr(bayes_runs_list, baseline_runs_list)
                pearson_corr = round(abs(corr), 3)
            else:
                pearson_corr = 0.0
        except Exception:
            pearson_corr = 0.0

        # Phase separation F-statistic from aggregated_df
        try:
            from scipy.stats import f_oneway
            pp = aggregated_df[aggregated_df["situation_label"].str.startswith("Powerplay")]["avg_runs_after_entry"].dropna().values
            mi = aggregated_df[aggregated_df["situation_label"].str.startswith("Middle")]["avg_runs_after_entry"].dropna().values
            de = aggregated_df[aggregated_df["situation_label"].str.startswith("Death")]["avg_runs_after_entry"].dropna().values
            if len(pp) > 5 and len(mi) > 5 and len(de) > 5:
                fstat, _ = f_oneway(pp, mi, de)
                phase_f = round(fstat, 2)
            else:
                phase_f = 0.0
        except Exception:
            phase_f = 0.0

        return BacktestResults(
            top1_accuracy=top1_hits / covered,
            top3_accuracy=top3_hits / covered,
            mean_rank_of_actual_best=round(rank_sum / covered, 2),
            improvement_pct=round(improvement, 1),
            coverage=round(covered / max(len(all_situations), 1), 3),
            bayes_mean_runs=round(bayes_mean, 1),
            baseline_mean_runs=round(baseline_mean, 1),
            pearson_correlation=pearson_corr,
            phase_f_statistic=phase_f,
            calibration_df=pd.DataFrame(calibration_rows),
            backtest_df=pd.DataFrame(results),
        )

    except Exception as e:
        print(f"Backtesting failed: {e}")
        import traceback
        traceback.print_exc()
        return BacktestResults()
