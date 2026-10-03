    // Biome-driven tree color tints (applied at runtime, never saved to placedTrees)
    // canopy = array of colors for natural variety. Each tree picks one based on position hash.
    // Trunk stays natural (#ffffff) — the 3D models already have proper bark textures.
    window.BIOME_TREE_TINTS = {
        'ALL':      { canopy: ['#ffffff'], trunk: '#ffffff' },
        'GLOBAL':   { canopy: ['#ffffff'], trunk: '#ffffff' },
        'CUSTOM':   { canopy: ['#ffffff'], trunk: '#ffffff' },
        'AUTUMN':   { canopy: ['#dd3322', '#ee6622', '#ff9933', '#ffcc22', '#cc8833', '#dd5544'], trunk: '#ffffff' },
        'WINTER':   { canopy: ['#aaccdd', '#99bbcc', '#bbddee'], trunk: '#ffffff' },
        'SNOW':     { canopy: ['#ddeeff', '#cce0f0', '#eef4ff'], trunk: '#ffffff' },
        'TROPICAL': { canopy: ['#22aa33', '#33bb44', '#44cc55'], trunk: '#ffffff' },
        'ISLAND':   { canopy: ['#33aa44', '#44bb55', '#55cc66'], trunk: '#ffffff' },
        'DESERT':        { canopy: ['#88a855', '#99aa55', '#778844'], trunk: '#ffffff' },
        'DESERT_AUTUMN': { canopy: ['#c2410c', '#b45309', '#9a3412'], trunk: '#ffffff' },
        'DESERT_WINTER': { canopy: ['#64748b', '#94a3b8', '#475569'], trunk: '#ffffff' },
        'DESERT_SUNSET': { canopy: ['#c2410c', '#b45309', '#9a3412'], trunk: '#ffffff' },
        'DESERT_COLD':   { canopy: ['#64748b', '#94a3b8', '#475569'], trunk: '#ffffff' },
        'MOON':          { canopy: ['#556677', '#667788', '#778899'], trunk: '#888899' },
        'CANDY':         { canopy: ['#ff88cc', '#88ccff', '#ffdd44', '#88ff88', '#cc88ff'], trunk: '#cc88ff' },
        'VOLCANO':       { canopy: ['#886633', '#775522', '#996644'], trunk: '#444444' },
    };
