    window.CLOUD_BIOMES = {};
    
    // Built-in biome configs (fallback if not in database)
    window.CLOUD_BIOMES['GLOBAL'] = {
        skyColor: '#87ceeb',
        obColor: '#ef4444',
        bunkerColor: '#e0d8a4',
        wasteColor: '#c2af7c',
        teeColor: '#7cb54c',
        greenColor: '#8acf72',
        foregreenColor: '#9acb67',
        fairwayColor: '#79b84f',
        semiColor: '#659a3f',
        roughColor: '#4c7d32',
        fescueColor: '#315b2b',
        waterColor: '#38bdf8',
        oceanColor: '#1e3a5f',
        horizonColor: '#cce7ff'
    };
    window.CLOUD_BIOMES['AUTUMN'] = {
        skyColor: '#c4a882',         // Warm hazy sky
        obColor: '#cc3333',
        bunkerColor: '#d4c090',      // Sandy warm
        wasteColor: '#b89860',       // Earthy
        teeColor: '#8a9a4a',         // Olive-green tee
        greenColor: '#7a9945',       // Warm green (still playable!)
        foregreenColor: '#8a8a3a',   // Yellow-green fringe
        fairwayColor: '#9a9040',     // Golden fairway
        semiColor: '#8b7535',        // Amber semi-rough
        roughColor: '#7a6530',       // Warm brown rough
        fescueColor: '#5a4020',      // Dark burnt sienna
        waterColor: '#4a8aaa',       // Cooler, moodier water
        oceanColor: '#2a4a5f',
        horizonColor: '#c4a070'      // Warm amber horizon
    };
    window.CLOUD_BIOMES['WINTER'] = {
        skyColor: '#b0c4d4',         // Cold pale sky
        obColor: '#cc4444',
        bunkerColor: '#d0ccc0',      // Pale sand
        wasteColor: '#b0a890',       // Frost-touched
        teeColor: '#6a8855',         // Cold green
        greenColor: '#6a9060',       // Desaturated green
        foregreenColor: '#708855',   // Muted fringe
        fairwayColor: '#688050',     // Dull green fairway
        semiColor: '#5a6a40',        // Faded semi
        roughColor: '#4a5a35',       // Dark cold rough
        fescueColor: '#fafcff',      // Snow-white deep rough (serves as volumetric snow clumps)
        waterColor: '#5a9ab8',       // Cold blue
        oceanColor: '#1a3050',
        horizonColor: '#9ab0c0'      // Cold grey-blue horizon
    };
    window.CLOUD_BIOMES['DESERT'] = {
        skyColor: '#d8b98b',         // Warm sun-bleached desert sky
        obColor: '#dc2626',
        bunkerColor: '#fde047',      // Bright dune sand
        wasteColor: '#c2853a',       // Red-ochre desert waste
        teeColor: '#84cc16',         // Desert manicured tee turf
        greenColor: '#4ade80',       // Vibrant irrigated green
        foregreenColor: '#65a30d',   // Fringe
        fairwayColor: '#a3e635',     // Desert fairway turf
        semiColor: '#ca8a04',        // Warm desert scrub
        roughColor: '#b45309',       // Red clay / sand rough
        fescueColor: '#78350f',      // Dark dry desert stone
        waterColor: '#0ea5e9',       // Sparkling blue oasis water
        oceanColor: '#0369a1',
        horizonColor: '#fef3c7'      // Warm golden horizon
    };
    window.CLOUD_BIOMES['DESERT_SUNSET'] = {
        skyColor: '#b45309',         // Warm sunset twilight sky
        obColor: '#dc2626',
        bunkerColor: '#fbbf24',      // Golden sunset sand
        wasteColor: '#9a3412',       // Dark burnt orange rock
        teeColor: '#65a30d',
        greenColor: '#4ade80',
        foregreenColor: '#4d7c0f',
        fairwayColor: '#84cc16',
        semiColor: '#b45309',
        roughColor: '#9a3412',
        fescueColor: '#451a03',
        waterColor: '#0284c7',
        oceanColor: '#0c4a6e',
        horizonColor: '#ea580c'      // Crimson/orange glow
    };
    window.CLOUD_BIOMES['DESERT_COLD'] = {
        skyColor: '#7dd3fc',         // Cold crisp pale sky
        obColor: '#ef4444',
        bunkerColor: '#e2e8f0',      // Pale cold sand
        wasteColor: '#64748b',       // Cold stone
        teeColor: '#4d7c0f',
        greenColor: '#22c55e',
        foregreenColor: '#16a34a',
        fairwayColor: '#65a30d',
        semiColor: '#475569',
        roughColor: '#334155',
        fescueColor: '#1e293b',
        waterColor: '#38bdf8',
        oceanColor: '#0369a1',
        horizonColor: '#bae6fd'      // Frosty light horizon
    };
    // Aliases for unified seasonal naming
    window.CLOUD_BIOMES['DESERT_AUTUMN'] = Object.assign({}, window.CLOUD_BIOMES['DESERT_SUNSET']);
    window.CLOUD_BIOMES['DESERT_WINTER'] = Object.assign({}, window.CLOUD_BIOMES['DESERT_COLD']);
    window.CLOUD_BIOMES['SNOW'] = window.CLOUD_BIOMES['WINTER'];
    window.CLOUD_BIOMES['MOON'] = {
        skyColor: '#05070e',         // Dark deep space void
        obColor: '#ef4444',
        bunkerColor: '#cbd5e1',      // Pale lunar crater sand / regolith
        wasteColor: '#64748b',       // Lunar basalt rock
        teeColor: '#94a3b8',         // Synthetic lunar tee mat
        greenColor: '#38bdf8',       // Bioluminescent / neon putting turf
        foregreenColor: '#0284c7',   // Fringe
        fairwayColor: '#64748b',     // Smooth compacted lunar regolith
        semiColor: '#475569',        // Rough crater ejecta
        roughColor: '#334155',       // Dark basalt floor
        fescueColor: '#1e293b',      // Deep space void rock
        waterColor: '#6366f1',       // Cosmic fluid / ice lake
        oceanColor: '#1e1b4b',
        horizonColor: '#0f172a'      // Dark cosmic horizon
    };

    // A copy of the built-in palettes. A database row (fetchCloudBiomes) replaces a whole palette, and the admin page has not always saved every
    // colour: what a row lacks is filled in from here (see changeBiome), not from the biome that happened to be active before.
    window.BUILTIN_BIOMES = {};
    Object.keys(window.CLOUD_BIOMES).forEach(function (k) { window.BUILTIN_BIOMES[k] = Object.assign({}, window.CLOUD_BIOMES[k]); });
