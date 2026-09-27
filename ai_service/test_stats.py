from ner import extract_cricket_entities
import json

# Test cases for stat verification
tests = [
    {
        "name": "Correct Stat",
        "text": "Virat Kohli is a legend with a batting average of 58.7 in ODIs."
    },
    {
        "name": "Incorrect Stat",
        "text": "Rohit Sharma is great but his average is only 25.0 according to some."
    },
    {
        "name": "Unknown Player Stat",
        "text": "The local player scored 50 runs quickly."
    }
]

def run_tests():
    print("--- Testing Factual Stat Verification ---")
    for t in tests:
        print(f"\nScenario: {t['name']}")
        print(f"Text: \"{t['text']}\"")
        res = extract_cricket_entities(t["text"])
        print(f"Stats Found: {json.dumps(res['stats_found'], indent=2)}")
        print(f"Stat Accuracy Score: {res['stat_accuracy']}%")
        
        if t["name"] == "Correct Stat" and res["stat_accuracy"] > 90:
            print("✅ PASS: Correct stat verified.")
        elif t["name"] == "Incorrect Stat" and res["stat_accuracy"] < 50:
            print("✅ PASS: Incorrect stat penalized.")
        elif t["name"] == "Unknown Player Stat":
            print(f"Partial Credit (Unknown Player): {res['stat_accuracy']}%")

if __name__ == "__main__":
    run_tests()
