# 🎮 FOODMANIA — Find Your Free Food!

A fun, interactive restaurant promotional mini-game built with **HTML5, CSS3 and Vanilla JavaScript** — no backend, no external dependencies.

**Play the game →** open `index.html` in any browser.

## ✨ Game Overview

Help customers of the **FOODMANIA** restaurant find hidden food items around a restaurant kitchen, then spin the Lucky Food Wheel to win a free treat.

### Screens
- **Welcome** — FOODMANIA branding, floating food emojis, entrance animation, and a big *“PLAY & WIN A FREE ORDER!”* button.
- **Levels** — three unlockable challenges with a lock icon on locked levels.
- **Game** — a clickable restaurant room with hidden foods, a mission panel, live timer and progress counter.
- **Lucky Spin** — a colourful 8-section prize wheel with real random prize selection.

### Levels
| Level | Name | Goal | Time |
|-------|------|------|------|
| 1 | Food Finder | Find 5 foods | 60s |
| 2 | Master Chef | Find 7 foods | 50s |
| 3 | Foodmania Champion | Find 10 foods | 45s |

Level 1 is unlocked from the start; completing a level unlocks the next one.

## 🎲 Spin the Food Wheel

Win prizes such as Free Pizza, Free Burger, Free French Fries, Free Donut, Free Drink, Free Dessert, a Special Surprise — or “Try Again”. The winner is chosen with real JavaScript logic, and the wheel animates until it stops precisely on that prize.

## 🎁 Rewards

Winning generates a unique reward code (e.g. `FOOD-7K9P2`) that is saved in `localStorage`, so it stays available after refreshing. Show the code to Foodmania staff to redeem.

> Prizes are subject to Foodmania's actual promotion terms. No real order is placed automatically.

## 🛠️ Tech

- `index.html` — structure
- `style.css` — olive green & white theme, responsive layout, animations
- `script.js` — game logic, timer, hidden-food placement, spin wheel, rewards

Sound effects and light background music are synthesised with the Web Audio API (with a mute toggle), so there are **no audio files or broken links**.

## 📱 Responsive

Works on desktop, tablet and mobile.

---

Made with love by FOODMANIA.
