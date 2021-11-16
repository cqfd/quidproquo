import random


def simulate():
    deck = list(range(0, 52))
    random.shuffle(deck)
    excess_odds = 0
    for card in deck:
        print(f"card = {card}; excess_odds was = {excess_odds}")
        if excess_odds > 2:
            return card % 2 == 0
        excess_odds += 1 if card % 2 == 1 else -1
    return card % 2 == 0


wins = 0
for _ in range(10000):
    wins += 1 if simulate() else -1

print(wins)
