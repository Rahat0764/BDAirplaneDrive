# ✈️ DREAM FLIGHT

**DREAM FLIGHT** is a peaceful, photorealistic, web-based 3D airplane flight experience built with **TypeScript, Three.js, Vite, and custom WebGL shaders**.

Soar between colossal white cumulus cloud towers, glide above patchwork emerald valleys, rivers, coastlines, and snow-capped alpine peaks, and watch a luminous moon hang in deep cerulean skies.

---

## ✨ Key Features

### 🌤 Hybrid Volumetric Cloud & Atmosphere System
- **Grand Cloud Canyon & Towering Cumulus Cathedrals**: Multi-lobe 3D volumetric-shaded cumulus spires with Beer-Powder light scattering, Henyey-Greenstein silver linings, internal self-shadowing, and gentle wind drift.
- **Ray-Sculpted Sky & Horizon Cloud Sea**: Custom GLSL atmospheric scattering with high-altitude cirrus wisps, an endless horizon cumulus deck, stars, and a crater-shaded Moon.
- **Interactive Cloud Fly-Through**: Smoothly enter and emerge from cloud formations with natural visibility attenuation, local canopy mist, and subtle aerodynamic turbulence.
- **5 Live Environment Presets**: *Afternoon Canyon (Signature)*, *Peaceful Morning*, *Golden Hour*, *Crimson Sunset*, and *Moonlit Blue Hour*.

### 🛩 Detailed Light Aircraft & Dual-Mode Flight Physics
- **3 Selectable PBR Light Aircraft**: *Cloudrunner SR-1* (low-wing touring monoplane), *Skyhawk Valley 180* (strut-braced high-wing cruiser), and *Albatross Glide-X* (long-span cloud soarer).
- **Animated Control Surfaces**: Moving ailerons, elevator, rudder, deployable wing airbrakes, retractable tricycle landing gear, spinning 3-blade propeller + motion-blur disc, navigation strobes, and wingtip condensation trails.
- **Relaxed Flight Mode (Default)** & **Normal Simulation Mode**: Full 6-DOF quaternion aerodynamics supporting peaceful stabilized cruising, manual runway takeoff, and smooth airport landings.

### 🎮 PS4 DualShock 4, Bluetooth Gamepad, Android Touch & Desktop Controls
- **Gamepad API**: Automatic detection for PS4 DualShock 4, PS5 DualSense, Xbox, and Bluetooth gamepads—complete with deadzone/sensitivity sliders, stick calibration, custom button/axis remapping, and a live **Controller Test Visualizer**.
- **Android Touch Interface**: Multi-touch virtual joystick, smooth touch throttle track, airbrake hold pad, and quick-action pills (*Camera, Gear, Sky, HUD Mode, Reset, Fullscreen*).
- **Keyboard & Mouse**: `WASD` / `Arrow Keys` (Pitch & Roll), `Q/E` (Yaw), `Shift/Ctrl` or `R/F` (Throttle), `Space/B` (Airbrakes), `G` (Landing Gear), `C` (Switch Camera), `H` (HUD Mode: Full / Minimal / Immersive), `Esc/P` (Menu).

### 🏞 Expansive Landscape & Peaceful Modes
- **Continuous 3D Scenery**: Patchwork green valley farmlands, meandering river, alpine mirror lake, instanced 3D forests, snow-capped mountains, animated ocean bay & islands, cozy valley villages, and **Dream Valley Regional Airport (Runway 36/18)**.
- **4 Exploration Modes**: *Free Flight*, *Scenic Journey* (7 guided sky-ribbon vistas), *Cloud Exploration*, and *Landing Approach*.
- **Procedural Web Audio Soundscape**: Multi-harmonic engine & propeller hum, silky aerodynamic wind, and original generative ambient music with independent volume sliders.

---

## 🆕 Dream Flight v3.0 Update

- **Simulation by default** — Simulation flight mode, stall simulation and collision damage are ON by default; Relaxed is opt-in in Settings → Flight.
- **Ground takeoff by default** — Free Flight starts parked on Runway 36 (throttle 0, gear down). Throttle up and rotate like a real pilot; Landing Challenge still starts airborne on final.
- **Realistic control feel** — control surfaces move with actuator lag (~120–180 ms in Simulation) and rate limits, plus angular inertia/damping, adverse yaw, prop torque, prop wash at low speed, and ground effect near the surface. Input polling itself has no artificial delay.
- **Road, ground & crash physics** — per-surface rolling friction/braking (runway, highway, grass), speed-fading wheel steering, suspension with gear compression and touchdown bounce, and crashes that slide to rest with friction. Gear-up belly landings scrape and decelerate instead of always crashing.
- **Ground-penetration fix** — a hard post-physics clamp guarantees the aircraft can never sink below the terrain/runway/highway/water surface (accounting for gear clearance and suspension compression).
- **Water & ocean** — slow-speed hull draft/sink with stronger drag, wave bobbing and planing, plus the existing open ocean with Gerstner waves.
- **Missions** — a new 6-mission campaign (First Takeoff, Climb Through the Ring, Valley Cruise, Lake Skim, Ocean Tour, Full Circuit Landing) with objectives, banners and progress saved in the browser.
- **Control hints** — every HUD/touch button shows a tiny badge: the gamepad glyph (✕, L1, R1, △, R3…) when a controller is connected — following your current remapping — or the keyboard key cap (G, C, V, T, Z, H…) otherwise.
- **Settings persistence** — flight mode/assists, graphics, aircraft, weather, time-of-day, HUD mode and audio are remembered in `localStorage` (`dream_flight_settings_v1`) and restored on load, with a “Reset saved settings” button in Graphics.
- **Graphics & FPS** — more responsive adaptive resolution (checks every 0.5 s, steps down below 45 FPS, up above 57 FPS, now also on Ultra), trimmed DPR caps (High 1.75×, Ultra 2.0×), improved slope-rock/altitude-snow terrain blending with cheaper shader noise, and zero per-frame allocations in the physics hot loop.

---

## 🚀 Local Development & Production Build

```bash
npm install
npm run dev
```

Build static production output (`dist/`):

```bash
npm run build
npm run preview
```

Configured out-of-the-box for static deployment on **Vercel** via [`vercel.json`](./vercel.json).
