"""
CricGeek AI Scoring — NER & Entity Extraction

Extracts player names, teams, stats from cricket blog text.
Uses a comprehensive list of player names + regex patterns for stats.
"""

import re
from typing import TypedDict


class Entity(TypedDict):
    name: str
    entity_type: str


class StatEntry(TypedDict):
    player: str
    stat_type: str
    value: str
    raw: str


class NERResult(TypedDict):
    entities: list[Entity]
    stats_found: list[StatEntry]
    stats_verified: float
    stat_accuracy: float
    cricket_depth: float


# ── Known Players Dictionary ─────────────────────────────────────────
CRICKET_PLAYERS = [
    # India
    "Virat Kohli", "Rohit Sharma", "Jasprit Bumrah", "MS Dhoni", "Sachin Tendulkar",
    "Hardik Pandya", "Rishabh Pant", "KL Rahul", "Shubman Gill", "Suryakumar Yadav",
    "Ravindra Jadeja", "Ravichandran Ashwin", "Yuzvendra Chahal", "Mohammed Shami",
    "Mohammed Siraj", "Kuldeep Yadav", "Ishan Kishan", "Shreyas Iyer", "Axar Patel",
    # Australia
    "Steve Smith", "David Warner", "Pat Cummins", "Mitchell Starc", "Nathan Lyon",
    "Josh Hazlewood", "Glenn Maxwell", "Travis Head", "Marnus Labuschagne",
    "Cameron Green", "Marcus Stoinis",
    # England
    "Joe Root", "Ben Stokes", "James Anderson", "Stuart Broad", "Jos Buttler",
    "Jonny Bairstow", "Harry Brook", "Dawid Malan", "Moeen Ali", "Mark Wood",
    "Jofra Archer",
    # Pakistan
    "Babar Azam", "Shaheen Afridi", "Mohammad Rizwan", "Naseem Shah", "Shadab Khan",
    "Fakhar Zaman", "Imam-ul-Haq",
    # NZ
    "Kane Williamson", "Trent Boult", "Tim Southee", "Devon Conway", "Daryl Mitchell",
    # South Africa
    "Kagiso Rabada", "Quinton de Kock", "Aiden Markram", "Temba Bavuma", "Lungi Ngidi",
    # West Indies
    "Kieron Pollard", "Chris Gayle", "Jason Holder", "Andre Russell", "Nicholas Pooran",
    "Shimron Hetmyer",
    # Sri Lanka
    "Angelo Mathews", "Dimuth Karunaratne", "Wanindu Hasaranga",
    # Bangladesh  
    "Shakib Al Hasan", "Mushfiqur Rahim", "Mustafizur Rahman",
    # Afghanistan
    "Rashid Khan", "Mohammad Nabi", "Mujeeb Ur Rahman",
    # Zimbabwe
    "Sikandar Raza",
]

CRICKET_PLAYERS_LOWER = {p.lower(): p for p in CRICKET_PLAYERS}

# ── Known Teams ──────────────────────────────────────────────────────
CRICKET_TEAMS = [
    "India", "Australia", "England", "Pakistan", "New Zealand", "South Africa",
    "West Indies", "Sri Lanka", "Bangladesh", "Afghanistan", "Zimbabwe", "Ireland",
    "Mumbai Indians", "Chennai Super Kings", "Royal Challengers Bangalore",
    "Kolkata Knight Riders", "Delhi Capitals", "Sunrisers Hyderabad",
    "Punjab Kings", "Rajasthan Royals", "Gujarat Titans", "Lucknow Super Giants",
]

# ── Stat Patterns ────────────────────────────────────────────────────
# Flexible matches for "average of 50", "average is 50", "avg: 50", "avg 50" etc.
SEP = r"(?:\s+(?:of|is|at|around|only|approx\.?|roughly|currently|his|her|its))*\s*[:\-]?\s*"

STAT_PATTERNS = [
    (r"\baverage" + SEP + r"(\d+(?:\.\d+)?)\b", "batting_average"),
    (r"\bavg\.?" + SEP + r"(\d+(?:\.\d+)?)\b", "batting_average"),
    (r"\bstrike\s+rate" + SEP + r"(\d+(?:\.\d+)?)\b", "strike_rate"),
    (r"\bsr\s+" + SEP + r"(\d+(?:\.\d+)?)\b", "strike_rate"),
    (r"\beconomy" + SEP + r"(\d+(?:\.\d+)?)\b", "economy_rate"),
    (r"\becon\.?" + SEP + r"(\d+(?:\.\d+)?)\b", "economy_rate"),
    (r"\b(\d+(?:\.\d+)?)\s+(?:economy|econ)\b", "economy_rate"),
    (r"\b(\d+)\s+wickets?\b", "wickets"),
    (r"\b(\d+)\s+(?:runs?|scored)\b", "runs_scored"),
    (r"\b(\d+)\s+(?:centuries|hundreds|100s)\b", "centuries"),
    (r"\b(\d+)\s+(?:fifties|half-centuries|50s)\b", "fifties"),
    (r"\b(\d+)\/(\d+)\b", "bowling_figures"),
    (r"\b(\d+(?:\.\d+)?)\s*%\s+dot\s+ball\b", "dot_ball_percent"),
    (r"\bdot\s+ball\s+(?:percentage|%|rate)" + SEP + r"(\d+(?:\.\d+)?)%?\b", "dot_ball_percent"),
    (r"\b(\d+(?:\.\d+)?)\s+(?:yorker|death\s+over)\s+(?:economy|econ)\b", "death_economy"),
]

# ── Cricket Terminology ──────────────────────────────────────────────
CRICKET_TERMS = [
    "wicket", "bowling", "batting", "innings", "over", "boundary", "six", "four",
    "captain", "opener", "spinner", "pace", "seam", "swing", "yorker", "bouncer",
    "lbw", "caught", "stumped", "run out", "maiden", "no ball", "wide",
    "test match", "test cricket", "odi", "one day", "t20", "twenty20", "ipl",
    "world cup", "ashes", "pitch", "crease", "pavilion", "duck", "century",
    "fifty", "hat-trick", "powerplay", "death overs", "middle overs",
    "googly", "doosra", "carrom ball", "reverse swing",
    "batting average", "bowling average", "strike rate", "economy rate",
    "dot ball", "wides", "extras",
]


# ── Factual Data (Sportmonks API Mock) ──────────────────────────────
# For production, this would be a live API call. 
FACT_CHECK_DATA = {
    "Virat Kohli": {
        "batting_average": 58.67,
        "strike_rate": 93.62,
        "centuries": 50,
        "runs_scored": 13848
    },
    "Rohit Sharma": {
        "batting_average": 49.12,
        "strike_rate": 91.97,
        "centuries": 31,
        "runs_scored": 10709
    },
    "Jasprit Bumrah": {
        "economy_rate": 4.63,
        "wickets": 149,
        "batting_average": 20.83,
    },
    "Steve Smith": {
        "batting_average": 56.97,
        "centuries": 32,
    },
    "Joe Root": {
        "batting_average": 50.12,
        "centuries": 31,
    },
    "Babar Azam": {
        "batting_average": 56.72,
        "strike_rate": 88.75,
    }
}


def extract_cricket_entities(text: str) -> NERResult:
    """
    Extract player names, teams, and stats from cricket blog text.
    Returns entities, stats found, and a cricket depth score.
    """
    entities: list[Entity] = []
    stats_found: list[StatEntry] = []
    text_lower = text.lower()

    # Find player mentions
    mentioned_players = []
    for player_lower, player_name in CRICKET_PLAYERS_LOWER.items():
        if player_lower in text_lower:
            entities.append({"name": player_name, "entity_type": "PLAYER"})
            mentioned_players.append(player_name)

    # Find team mentions
    for team in CRICKET_TEAMS:
        if team.lower() in text_lower:
            entities.append({"name": team, "entity_type": "TEAM"})

    # Extract stats using patterns
    for pattern, stat_type in STAT_PATTERNS:
        for match in re.finditer(pattern, text_lower, re.IGNORECASE):
            raw = match.group(0)
            value = match.group(1)
            # Assign to the most recently mentioned player, or "Unknown"
            associated_player = mentioned_players[0] if mentioned_players else "Unknown"
            # Try to find a player name close to the stat in the text
            match_pos = match.start()
            best_player = "Unknown"
            best_dist = len(text)
            for player_lower, player_name in CRICKET_PLAYERS_LOWER.items():
                idx = text_lower.rfind(player_lower, 0, match_pos)
                if idx != -1 and (match_pos - idx) < best_dist:
                    best_dist = match_pos - idx
                    best_player = player_name
            stats_found.append({
                "player": best_player,
                "stat_type": stat_type,
                "value": value,
                "raw": raw,
            })

    # Cricket depth: how many cricket-specific terms appear
    term_hits = sum(1 for term in CRICKET_TERMS if term in text_lower)
    cricket_depth = min(100.0, (term_hits / max(len(CRICKET_TERMS), 1)) * 200)

    # Stat verification: Comparing extracted numbers against FACT_CHECK_DATA
    stats_verified = 0.0
    total_stats = len(stats_found)
    
    for s in stats_found:
        player = s["player"]
        stat_type = s["stat_type"]
        val_str = s["value"]
        
        # If we have ground truth for this player
        if player in FACT_CHECK_DATA:
            truth = FACT_CHECK_DATA[player]
            if stat_type in truth:
                try:
                    extracted_val = float(val_str)
                    target_val = float(truth[stat_type])
                    
                    # Margin of error (5%) for slightly outdated stats
                    if abs(extracted_val - target_val) / target_val < 0.05:
                        stats_verified += 1.0
                except (ValueError, ZeroDivisionError):
                    pass
        elif player != "Unknown":
            # If player is known but we lack specific ground-truth for that stat,
            # we give 0.5 points for "Relevant Player Association"
            stats_verified += 0.5

    stat_accuracy = (stats_verified / total_stats * 100) if total_stats > 0 else 85.0

    return {
        "entities": entities,
        "stats_found": stats_found,
        "stats_verified": stats_verified,
        "stat_accuracy": min(100.0, float(stat_accuracy)),
        "cricket_depth": cricket_depth,
    }
