import sys
from unittest.mock import MagicMock

# Mock the models module before importing scoring
mock_models = MagicMock()
sys.modules['models'] = mock_models

import scoring
import json

# The user's specific problematic text
test_text = """
The sun was beginning to dip below the horizon, casting long, amber shadows across the field as he sat on the grass, his laptop screen glowing against the fading light. He wasn't just looking at a spreadsheet; he was looking at a pulse. He described the way the data points started to cluster, forming a shape that mirrored the bowler’s tiring rhythm in the fortieth over. To him, the sudden dip in a player's strike rate wasn't a failure—it was a breadcrumb leading back to a slight technical shift in their stance after a previous injury.

As he spoke, his voice carried the excitement of a navigator who had finally found land. He walked through the moment the numbers shifted from abstract digits into a vivid picture of human pressure and physical limits. It was an immersive journey through the "why" behind the "what," where every outlier in the deck became a character with a motive, and every trend line told a secret about the game that the naked eye usually missed.
"""

def test_logic():
    print("--- Testing Archetype Refinement Logic ---")
    
    # Mock the BART classifier to return 'Analyst' as the top result (what was happening before)
    # The labels here are the NEW descriptive labels
    mock_classifier = MagicMock()
    mock_classifier.return_value = {
        "labels": scoring.ARCHETYPE_LABELS,
        # Before refinement, Analyst would be top (e.g. 0.45) and Storyteller lower (e.g. 0.35)
        # because of keywords like 'spreadsheet' and 'data points'
        "scores": [0.45, 0.35, 0.15, 0.05] 
    }
    
    # Inject the mock
    mock_models.get_models.return_value = {"bart_classifier": mock_classifier}
    
    print("Running classification with 'Narrative Intensity' heuristic...")
    result = scoring.classify_archetype(test_text)
    
    print(f"\nFinal Classification: {result['label'].upper()}")
    print(f"Confidence: {result['confidence']}")
    print(f"Scores: {json.dumps(result['scores'], indent=2)}")
    
    # The heuristic should boost Storyteller by 0.15, 
    # making it 0.35 + 0.15 = 0.50, which is > 0.45
    if result["label"] == "storyteller":
        print("\n✅ SUCCESS: Heuristic correctly boosted Storyteller over Analyst!")
    else:
        print(f"\n❌ FAILURE: Still classified as {result['label']}")

if __name__ == "__main__":
    test_logic()
