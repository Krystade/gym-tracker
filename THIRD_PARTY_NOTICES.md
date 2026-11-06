# Third-party notices

Gym Tracker ships the following third-party material. The build copies this file into the app (`THIRD_PARTY_NOTICES.md` at the
site root), and the notice also heads the body map's paths (`src/ui/body/paths.ts`, kept in the built chunk).

## Body map geometry

The front and back body outlines in `src/ui/body/paths.ts` come from MuscleMap's male paths
(`Sources/MuscleMap/Data/MaleFrontPaths.swift`, `MaleBackPaths.swift`, commit 5f576a5), whose outlines are those of
react-native-body-highlighter (`assets/bodyFront.ts`, `assets/bodyBack.ts`). Left and right paths are joined per muscle and the
coordinates rounded to a tenth of a unit.

### MuscleMap

https://github.com/melihcolpan/MuscleMap

```
MIT License

Copyright (c) 2026 Melih Colpan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### react-native-body-highlighter

https://github.com/HichamELBSI/react-native-body-highlighter

```
MIT License

Copyright (c) 2022 ELABBASSI Hicham

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Buddy art

The buddies and held items (`public/buddies/`) are pixel art from these packs. Of the older characters only each one's idle
frames (a vehicle: its one image) are used, renamed to the buddy's id; the app draws them scaled up, pixels kept square. The
Buddies screen's Credits list the same.

- Tiny Creatures by Clint Bellanger, https://opengameart.org/content/tiny-creatures (CC0 1.0)
- Tiny Dungeon and Tiny Town by Kenney, https://kenney.nl/assets/tiny-dungeon (CC0 1.0)
- Pixel Vehicle Pack by Kenney, https://kenney.nl/assets/pixel-vehicle-pack (CC0 1.0): Sudo, Turo, Wiwi, Tubo, Susy, Fenro, Domo
- Goat Characters by ChaosWitchNikol, https://chaoswitchnikol.itch.io/goat-characters, licensed under CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/): Moko, Lumi, Nuro, Gado, Roro
- Animal Characters by ChaosWitchNikol, https://chaoswitchnikol.itch.io/animal-characters, licensed under CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/): Boba, Lufu, Kiri, Tupip
- Dino Characters by Arks (@ArksDigital), https://arks.itch.io/dino-characters, licensed under CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/): Dodo, Moro, Tado, Wity
- Froglet by Lukas Lundin, https://phewcumber.itch.io/froglet: free to use, not to be resold on its own. Ropip
- Mr. & Mrs. Dude by toadgirl, https://toadgirl.itch.io/mr-and-mrs-dude: free to use for anything. Mr. Dude, Mrs. Dude
