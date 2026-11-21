# Dream Flight v3.0 — Polished Feature Spec
Source: rahat + friend's wishlist, polished 2026-11-21

## Friend's raw thought, polished
> "Make it feel like a real plane, not an arcade toy. Inputs shouldn't snap instantly —
> a real aircraft answers a little late, with weight and inertia, and that small delay
> is exactly what makes it feel real. Simulation should be the default way to fly;
> Relaxed is the chill mode you switch to in Settings when you just want to float
> around. You should start on the runway and take off yourself, like a real pilot.
> And whatever device I'm using — controller or keyboard — just show me the little
> button next to the action on screen, so I never have to memorise anything.
> The game should remember how I left it."

## Implemented in v3.0
1. **Simulation ON by default** — FlightPhysics default flightMode='simulation',
   collisionDamage=true, stallSimulation=true. Relaxed is opt-in via Settings (Flight tab).
2. **Ground takeoff by default** — Free Flight now spawns parked on Runway 36
   (throttle 0, gear down, onGround) instead of mid-air. Other modes keep their spawns;
   Landing Challenge stays airborne on final.
3. **Realistic control feel — intentional small latency** — NOT input lag from the engine:
   - Actuator lag: control surfaces deflect with a first-order lag (~120-180ms in Sim,
     faster in Relaxed) instead of snapping to stick position.
   - Rate limiting: surfaces can't move faster than a real servo/actuator.
   - Angular inertia/damping: pitch/roll/yaw accelerate and settle, with adverse yaw
     and prop torque in Simulation.
   Engine input polling itself stays immediate (no artificial frame delay).
4. **Flight physics** — ground effect near surface, coordinated-turn already present +
   adverse yaw, stall break sharper in Sim, prop-wash at low speed/high throttle.
5. **Road / ground physics** — per-surface rolling friction & braking (runway < highway <
   grass/terrain), wheel steering fades with speed, suspension spring + gear compression
   so the plane sits/bounces on its gear instead of clipping.
6. **Crash physics** — impact is judged by sink rate + bank + gear state + surface.
   Hard crash: plane slides/tumbles with friction and comes to rest (no instant freeze),
   then auto-recover prompt. Belly/gear-up landing scrapes and decelerates instead of
   instantly crashing in all cases.
7. **Ground-penetration fix (the landing sink bug)** — hard post-physics clamp:
   centre Y can never go below surfaceY + gearClearance - gearCompression, vertical
   velocity is zeroed/reflected by suspension, and AGL is computed from the same surface
   function the mesh is built from. Applied for terrain, runway, highway, bridge and water.
8. **Water physics + Ocean** — buoyancy + planing as before, plus: slow-speed sink/draft,
   wave-slope alignment, spray scales with speed. Ocean already in world; wave height
   function shared CPU/GPU kept in sync, larger swell in open sea.
9. **Missions** — new `missions` gameplay mode: a 6-mission campaign
   (First Takeoff → Climb & Ring → Valley Cruise → Lake Skim → Ocean Tour → Full Landing)
   with objective text, distance/time, pass/fail on landing quality, progress saved.
   Plus mission picker in the menu (uses existing scenic waypoints where sensible).
10. **Control hints on screen** — every HUD / touch button gets a tiny badge under/beside it:
    - Gamepad connected: shows the gamepad glyph/label for that action (✕, L1, R1, △, R3…)
      using the *current* mapping (so remapping updates the badges).
    - Keyboard: shows the key cap (G, C, V, T, Z, H, P…).
    Badges switch automatically with activeSource / gamepad connection.
11. **Settings persistence** — browser remembers last-used: flight mode + assists,
    graphics preset, aircraft, weather, time/auto-day-night, HUD mode, camera mode,
    audio volumes, controller settings (already saved). Stored in localStorage
    `dream_flight_settings_v1`, restored on load, with a "Reset saved settings" button.
12. **Graphics + FPS** — better + faster at once:
    - Adaptive resolution more responsive (targets 55-60 FPS, steps down/up faster,
      floor lower on weak devices), Ultra now also adaptive.
    - DPR caps trimmed (high 2.0→1.75, ultra 2.25→2.0) — big FPS win, negligible visual loss.
    - Terrain shader: slope-based rock/snow blending improved for more realistic mountains
      (steeper = rockier, high altitude = snow), cheaper noise (fewer octaves in fragment).
    - ACES exposure / fog tuned slightly; shadows stay PCF soft.
    - Keep instancing for trees/buildings (already instanced) — no per-frame allocations
      in physics hot loop (reuse temp quaternions instead of `new` per frame).
