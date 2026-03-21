# Shadow Striker X

A browser-based 2D fighting game with:
- 3 playable fighters
- persistent player saves
- unlockable progression
- 100 total levels

## Project Structure

- `index.html` - HTML layout and game screens
- `styles.css` - all UI/game styling
- `script.js` - game logic, combat system, audio, progression, storage

## Run the Game

### Option 1: Open directly
1. Open `index.html` in your browser.

### Option 2: Use a local server (recommended)
If your browser blocks some features from local files, run a simple local server:

```bash
python -m http.server 8000
```

Then open:

[http://localhost:8000](http://localhost:8000)

## Controls

- `Q` / `1` - Punch
- `W` / `2` - Kick
- `E` / `3` - Special
- `R` / `4` - Heal
- `A` / `Left` - Move back
- `D` / `Right` - Move forward
- `S` / `Down` - Block

## Notes

- Progress and player data are saved in browser storage.
- Best experience is on Chromium-based browsers.
