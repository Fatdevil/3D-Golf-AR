/**
 * Golf OS — Lightweight i18n Engine
 * Ultra-fast, zero-dependency translation dictionary.
 * Default: English ('en'). Supported: English ('en'), Swedish ('sv').
 */

(function() {
    const STORAGE_KEY = 'golf_os_lang';
    
    const DICTIONARY = {
        en: {
            // General & Common
            "nav_back": "← Back",
            "nav_hub": "← Hub",
            "nav_build": "← Back to Build",
            "logo_sub": "GOLF OS",
            "loading": "Loading...",
            "free_player": "Free Player",
            "lm_connected": "LM Connected",
            "lm_disconnected": "LM Disconnected",
            "cancel": "Cancel",
            "confirm": "Confirm",
            "close": "Close",
            "save": "Save",
            "edit": "Edit",
            "play": "Play",
            "delete": "Delete",
            "discard_prompt": "Discard unsaved changes and start a new project?",
            
            // Hub (arcade_hub.html)
            "hub_title": "SELECT ACTIVITY",
            "hub_range_badge": "Practice",
            "hub_range_title": "Range",
            "hub_range_desc": "Practice on the driving range and track your shots.",
            "hub_courses_badge": "Community",
            "hub_courses_title": "Courses",
            "hub_courses_desc": "Play your drafts and challenge the world.",
            "hub_build_badge": "Editor",
            "hub_build_title": "Build",
            "hub_build_desc": "Sculpt, build and publish your own custom courses.",
            "hub_games_badge": "Coming Soon",
            "hub_games_title": "Games",
            "hub_games_desc": "Neon-putting, moongolf, and party challenges.",
            
            // Build Page (build.html)
            "build_title": "Course Creator",
            "build_subtitle": "Create a new course from scratch, continue on a draft, or edit your published courses.",
            "btn_new_plate": "⛳ New Course (3 Holes)",
            "btn_new_range": "🏌️ New Range",
            "btn_col_6h": "📦 6H Course",
            "btn_col_9h": "📦 9H Course",
            "btn_col_18h": "📦 18H Course",
            "section_drafts": "My Drafts",
            "section_published": "My Published",
            "section_collections": "Multi-Plate Collections",
            "badge_draft": "DRAFT",
            "badge_published": "PUBLISHED",
            "badge_collection": "MULTI-PLATE",
            "quick_draft_title": "Quick Draft",
            "quick_draft_desc": "Your last session in the editor",
            "quick_draft_local": "⚡ Local backup",
            "empty_drafts": "No saved drafts found.",
            "empty_published": "Loading published courses...",
            
            // New Course / Starting Plate (new_course.html)
            "nc_title": "CREATE NEW COURSE",
            "nc_subtitle": "Select your world, then choose a terrain layout to start building.",
            "nc_step1": "1. SELECT WORLD / BIOME",
            "nc_step1_sub": "Choose the environment theme for your course",
            "nc_step2": "2. SELECT TERRAIN PLATE",
            "nc_step2_sub": "Choose the starting landscape layout",
            "nc_step3": "3. SELECT SEASON & ATMOSPHERE",
            "nc_step3_sub": "Choose seasonal weather and lighting atmosphere",
            
            // Worlds
            "world_grass": "Grassland",
            "world_grass_sub": "Parkland & Lakes",
            "world_desert": "Desert",
            "world_desert_sub": "Sand & Canyons",
            "world_moon": "Moon",
            "world_moon_sub": "Space & Craters",
            "nc_selected_setup": "Selected Setup",
            
            "btn_start_build": "🚀 START BUILDING",
            
            // Editor / Arcade
            "save": "Save",
            "saved": "Saved",
            "saving": "Saving...",
            "ed_test_course": "Test Course",
            "test_course": "Test Course",
            "ed_build_mode": "Build",
            "ed_save_draft": "Save Draft",
            "ed_publish": "Publish",
            "ed_undo": "Undo",
            "ed_redo": "Redo",
            "ed_clear": "Clear Course",
            "tab_tools": "Tools",
            "tab_env": "Environment",
            "tab_map": "Map",
            "sculpt_tools_header": "Sculpt Terrain",
            "tool_inspect": "Inspect",
            "tool_course": "Holes",
            "tool_spline": "Fences & Walls",
            "tool_hole": "Range",
            "tool_sculpt": "Sculpt",
            "tool_paint": "Paint Surface",
            "tool_water": "Water",
            "tool_props": "Objects",
            "tool_env": "Environment",
            "tool_block": "Block",
            "tool_measure": "Measure",
            "tool_eraser": "Eraser",
            "tool_undo": "Undo",
            "tool_redo": "Redo",
            "tool_grid": "Grid",
            "tool_rings": "Rings",
            "tool_pro_mode": "Pro Mode",
            "tool_basic_mode": "Basic Mode",
            "sub_sculpt": "Sculpt",
            "sub_smooth": "Smooth",
            "sub_mtn": "Mountain",
            "sub_flatten": "Flatten",
            "sub_ramp": "Ramp",
            "sub_ridge": "Ridge",
            "sub_noise": "Noise",

            // Flyout Navigation
            "flyout_objects_header": "Objects & Scenery",
            "flyout_obj_trees": "Trees",
            "flyout_obj_plants": "Plants & Bushes",
            "flyout_obj_rocks": "Rocks",
            "flyout_obj_fences": "Fences & Walls",
            "flyout_obj_blocks": "Building Blocks",
            "flyout_obj_colorize": "Colorize",
            "flyout_sculpt_header": "Sculpt Terrain",
            "flyout_env_header": "Environment & Sky",
            "flyout_env_sun": "Light & Time",
            "flyout_env_weather": "Weather & Wind",
            "flyout_env_surround": "Horizon & Ocean",
            "flyout_env_grass": "3D Grass & Particles",

            // Environment Panels
            "env_sun_header": "Lighting & Time of Day",
            "env_sun_pos": "Sun Position",
            "env_quick_select": "Quick Presets",
            "env_dawn": "🌅 Dawn",
            "env_day": "☀️ Day",
            "env_golden": "🌇 Golden",
            "env_night": "🌙 Night",
            "env_fog": "Fog Density",
            "env_fog_clear": "Clear",
            "env_fog_dense": "Dense Fog",
            "env_weather_header": "Weather & Wind",
            "env_weather_label": "Weather",
            "env_wind_speed": "Wind Speed",
            "env_wind_calm": "Calm (0)",
            "env_wind_storm": "Storm (30 mph)",
            "env_wind_dir": "Wind Direction",
            "env_surround_header": "Surrounding Horizon",
            "env_surround_desc": "Choose what meets the eye at the course edges. Saved automatically.",
            "env_surround_north": "North (N)",
            "env_surround_east": "East (E)",
            "env_surround_south": "South (S)",
            "env_surround_west": "West (W)",
            "env_surround_blend": "Horizon Transition",
            "env_blend_soft": "Soft blend",
            "env_blend_sharp": "Sharp edge",
            "env_grass_header": "3D Grass & Particles",
            "env_grass_3d": "Volumetric 3D Grass",
            "env_grass_rough_h": "Rough Height",
            "env_grass_deep_h": "Deep Rough Height",
            "env_particles_label": "Particles (Leaves & Pollen)",
            "env_particles_none": "None",
            "env_particles_max": "Maximum",
            "env_particle_size": "Particle Size",
            "env_particle_tiny": "Tiny",
            "env_particle_huge": "Huge",

            // Weather options
            "weather_clear": "☀️ Clear / Sunny",
            "weather_overcast": "☁️ Overcast / Cloudy",
            "weather_drizzle": "🌦️ Light Drizzle",
            "weather_rain": "🌧️ Rain",
            "weather_storm": "⛈️ Thunderstorm",
            "weather_fog": "🌫️ Dense Fog",

            // Horizon options
            "surr_opt_none": "❌ None",
            "surr_opt_rough": "🟢 Rough",
            "surr_opt_waste": "🟡 Waste / Sand",
            "surr_opt_fescue": "🌲 Deep Rough",
            "surr_opt_water": "💧 Lake (Water)",
            "surr_opt_ocean": "🌊 Ocean",
            "surr_opt_horizon": "🌫️ Mountain Horizon",
            "surr_opt_sky": "⛅ Sky",

            // Spline (Fences & Walls)
            "spline_header": "Fences & Walls",
            "spline_desc": "Click and draw a line on the ground to build fences, walls or hedges along the curve.",
            "spline_choose_type": "Select Type",
            "spline_wood_fence": "Wood Fence",
            "spline_stone_wall": "Stone Wall",
            "spline_ob_stakes": "O.B. Stakes",
            "spline_hedge": "Leaf Hedge",
            "spline_clear": "❌ Clear drawn line",

            // Hole Builder (Smart Builder)
            "flyout_holes_header": "Hole Builder",
            "sb_type_green": "Green",
            "sb_type_fairway": "Fairway",
            "sb_type_bunker": "Bunker",
            "sb_type_tee": "Tee",
            "sb_type_aim": "Aim Point",
            "sb_green_header": "Green & Mowing",
            "sb_fairway_header": "Fairway & Rough",
            "sb_bunker_header": "Bunker & Sand",
            "sb_tee_header": "Tee Box & Markers",
            "sb_aim_header": "Aim Point & Target",
            "sb_build_green": "⛳ Build Green",
            "sb_build_fairway": "🏌️ Build Fairway",
            "sb_build_bunker": "🏖️ Build Bunker",
            "sb_build_tee": "🟦 Build Tee Box",
            "sb_clear_points": "❌ Clear Drawn Shape",
            "sb_contour": "Contour",
            "sb_foregreen": "Foregreen",
            "sb_green_active": "Active Green",
            "sb_adopt_green": "✨ Make Green Editable (Live Studio)",
            "sb_existing_green_found": "⛳ Existing Green detected",
            "sb_elevation_offset": "Elevation",
            "sb_blend_distance": "Slope Blend",
            "sb_move_green": "✥ Move Green",
            "sb_redraw_green": "🔄 Adjust Shape",
            "sb_adjust_shape": "🔄 Adjust Shape",
            "sb_move_flag": "🎯 Move Flag",
            "sb_studio_locked_hint": "🔒 Live Studio activates once green is built",
            "sb_draw_min_points_hint": "✏️ Click on ground to shape green (min 3 points)",
            "sb_scale_title": "Green Size (Scale)",
            "sb_scale_down": "Scale Down (-10%)",
            "sb_scale_up": "Scale Up (+10%)",
            "sb_raised_green": "Raised Green (optional)",
            "sb_surround_h": "Surround Height",
            "sb_surround_r": "Surround Radius",
            "sb_tilt_aim": "Tilt → AimPoint",
            "sb_mow_pattern": "Mowing Pattern",
            "sb_edge": "Edge Sharpness",
            "sb_bunker_depth": "Depth",
            "sb_bunker_lip": "Lip",
            "sb_bunker_shape": "Shape",
            "sb_bunker_plural": "Bunkers",
            "sb_new_bunker": "➕ New Bunker",
            "sb_bunker_item": "Bunker",
            "sb_bunker_active": "Active Bunker",
            "sb_find_bunker": "🔍 Find on Map",
            "sb_move_bunker": "✥ Move Bunker",
            "sb_redraw_bunker": "🔄 Adjust Shape",
            "sb_delete_bunker": "🗑️ Delete Bunker",
            "sb_delete_all_bunkers": "🗑️ Delete All Bunkers",
            "sb_scale_bunker_title": "Bunker Size (Scale)",
            "sb_bunker_outline_visible": "👁️ Yellow Outline: Visible",
            "sb_bunker_outline_hidden": "👁️‍🗨️ Yellow Outline: Hidden",
            "sb_bunker_draw_min_points_hint": "✏️ Click on ground to shape bunker (min 3 points)",
            "sb_bunker_studio_locked_hint": "🔒 Live Studio activates once bunker is built",
            "sbk_tab_form": "1. Shape",
            "sbk_tab_profil": "2. Profile & Lip",
            "sbk_tab_sand": "3. Sand & Finish",
            "sbk_step_draw_hint": "Click to place golf balls. Drag any ball to adjust shape. Right click to delete.",
            "sbk_tip_drag": "💡 <b>Drag</b> large white golf balls to adjust shape. <b>Click yellow line</b> to add point, <b>right-click</b> to delete.",
            "sbk_selected_badge": "● Bunker selected",
            "sbk_step2_btn": "Step 2: Adjust depth & lip ➔",
            "sbk_step3_btn": "Step 3: Sand color & finish ➔",
            "sbk_finish_btn": "✔ Bunker Done!",
            "sbk_models": "Bunker Presets",
            "sbk_preset_bowl": "Bowl",
            "sbk_preset_pot": "Pot Bunker",
            "sbk_preset_flat": "Flat Bottom",
            "sbk_preset_waste": "Waste Bunker",
            "sbk_lip_direction": "Lip Direction",
            "sbk_lip_to_flag": "🚩 Towards Flag",
            "sbk_reset_profile": "↺ Reset Profile",
            "sbk_sand_type": "Sand Type & Color",
            "sbk_sand_augusta": "Augusta White",
            "sbk_sand_augusta_sub": "Quartz Sand",
            "sbk_sand_golden": "Golden Sand",
            "sbk_sand_golden_sub": "Classic Parkland",
            "sbk_sand_links": "Scottish Links",
            "sbk_sand_links_sub": "Gray-brown tone",
            "sbk_sand_coastal": "Coastal Dune",
            "sbk_sand_coastal_sub": "Soft dune sand",
            "sbk_edge_title": "Edge Sharpness / Sod Wall",
            "sbk_edge_sod": "Cut Sod Wall",
            "sbk_edge_soft": "Soft Sand Rim",
            "sb_fairway_terrain": "Terrain",
            "sb_fairway_active": "Active Fairway",
            "sb_new_fairway": "➕ New Fairway",
            "sb_fairway_item": "Fairway",
            "sb_fairway_plural": "Fairways",
            "sb_fairway_outline_visible": "👁️ Fairway Outline: Visible",
            "sb_fairway_outline_hidden": "👁️‍🗨️ Fairway Outline: Hidden",
            "sb_drawing_new_fairway": "✏️ Drawing new Fairway...",
            "sb_find_fairway": "🔍 Find on Map",
            "sb_delete_fairway": "🗑️ Delete Fairway",
            "sb_delete_all_fairways": "🗑️ Delete All Fairways",
            "sb_clean_ghosts": "🧹 Clean Ghost Fairways",
            "sb_redraw_fairway": "🔄 Adjust Shape",
            "sb_scale_fairway_title": "Fairway Size (Scale)",
            "sb_move_fairway": "✥ Move Fairway",
            "sb_fairway_studio_locked_hint": "🔒 Live Studio activates once fairway is built",
            "sb_fairway_draw_min_points_hint": "✏️ Click on ground to shape fairway (min 3 points)",
            "sf_step_draw": "Draw Shape",
            "sf_draw_hint": "Click on terrain to place fairway points. Drag any point to adjust shape. Right-click to delete.",
            "sf_form_tip": "💡 Drag the 3D golf balls to mold the fairway. Click between two balls on the green line to insert a new handle. Right-click a ball to delete it.",
            "sf_area_label": "Area",
            "sf_to_step2": "Step 2: Adjust Rough & Terrain",
            "sf_terrain_profile_title": "Undulation & Terrain Profile",
            "sf_to_step3": "Step 3: Mowing Pattern & Finish",
            "sf_finish": "Done with fairway!",
            "gs_step_draw": "Draw Shape",
            "gs_draw_hint": "Click on terrain to place golf balls. Drag any ball to adjust shape. Right-click to delete.",
            "gs_undo_point": "Undo point",
            "gs_reset": "Start over",
            "gs_create_green": "Create Green",
            "sb_semi_rough": "Semi-Rough",
            "sb_rough": "Rough",
            "sb_deep_rough": "Deep Rough",
            "sb_surface_type": "Surface Type",
            "sb_sand": "Sand",
            "sb_waste": "Waste",
            "sb_ob": "OB",
            "sb_custom": "Custom:",
            "sb_use_custom": "Use Custom",
            "sb_edge_hardness": "Freehand Edge Hardness",
            "sb_tee_markers": "Tee Markers",
            "sb_raised_tee": "Raised Tee (optional)",
            "sb_aim_instruction": "🎯 Click terrain to set aim point",
            "sb_aim_hint": "Click again to move • Right click to remove",
            "sb_aim_delete": "🗑️ Delete Aim Point",
            "sb_drawing_hint": "Click to place points. Connect to start ball or click Build.",
            "sb_tee_step1": "Step 1: Aim Point",
            "sb_tee_step2": "Step 2: Tee Markers",
            "sb_tee_aim_desc": "Aim point sets landing direction and aligns tee marker balls.",
            "sb_aim_required": "⚠️ Required",
            "sb_aim_set": "✅ Aim Set",
            "sb_btn_set_aim_txt": "Set Aim Point on Map",
            "sb_btn_move_aim_txt": "Move Aim Point"
        },
        sv: {
            // General & Common
            "nav_back": "← Tillbaka",
            "nav_hub": "← Hub",
            "nav_build": "← Tillbaka till Bygg",
            "logo_sub": "GOLF OS",
            "loading": "Laddar...",
            "free_player": "Gratis Spelare",
            "lm_connected": "LM Ansluten",
            "lm_disconnected": "LM Frånkopplad",
            "cancel": "Avbryt",
            "confirm": "Bekräfta",
            "close": "Stäng",
            "save": "Spara",
            "edit": "Redigera",
            "play": "Spela",
            "delete": "Radera",
            "discard_prompt": "Kastar osparad data. Nytt projekt?",
            
            // Hub (arcade_hub.html)
            "hub_title": "VÄLJ AKTIVITET",
            "hub_range_badge": "Träning",
            "hub_range_title": "Range",
            "hub_range_desc": "Träna på driving rangen och analysera dina slag.",
            "hub_courses_badge": "Community",
            "hub_courses_title": "Banor",
            "hub_courses_desc": "Spela dina banor och utmana andra spelare.",
            "hub_build_badge": "Banbyggare",
            "hub_build_title": "Bygg",
            "hub_build_desc": "Skulptera, bygg och publicera dina egna banor.",
            "hub_games_badge": "Kommer Snart",
            "hub_games_title": "Spel",
            "hub_games_desc": "Neon-putting, mångolf och partylägen.",
            
            // Build Page (build.html)
            "build_title": "Bygg bana",
            "build_subtitle": "Skapa en ny bana från grunden, fortsätt på ett sparat utkast eller redigera dina publicerade mästerverk.",
            "btn_new_plate": "⛳ Ny platta (3 hål)",
            "btn_new_range": "🏌️ Ny range",
            "btn_col_6h": "📦 Ny bana 6H",
            "btn_col_9h": "📦 Ny bana 9H",
            "btn_col_18h": "📦 Ny bana 18H",
            "section_drafts": "Mina Utkast",
            "section_published": "Mina Publicerade",
            "section_collections": "Mina Collections",
            "badge_draft": "DRAFT",
            "badge_published": "PUBLISHED",
            "badge_collection": "MULTI-PLATE",
            "quick_draft_title": "Snabbutkast",
            "quick_draft_desc": "Din senaste session i editorn",
            "quick_draft_local": "⚡ Lokal backup",
            "empty_drafts": "Inga sparade utkast hittades.",
            "empty_published": "Laddar publicerade banor...",
            
            // New Course / Starting Plate (new_course.html)
            "nc_title": "SKAPA NY BANA",
            "nc_subtitle": "Välj din värld, och välj sedan en startlayout för att börja bygga.",
            "nc_step1": "1. VÄLJ VÄRLD / MILJÖ",
            "nc_step1_sub": "Välj miljötema och atmosfär för din bana",
            "nc_step2": "2. VÄLJ STARTPLATTA",
            "nc_step2_sub": "Välj utgångslayout för terrängen",
            "nc_step3": "3. VÄLJ ÅRSTID & ATMOSFÄR",
            "nc_step3_sub": "Välj säsong, väderlek och stämning för banan",
            
            // Worlds
            "world_grass": "Gräsmark",
            "world_grass_sub": "Parkbana & sjöar",
            "world_desert": "Öken",
            "world_desert_sub": "Sand & kanjoner",
            "world_moon": "Månen",
            "world_moon_sub": "Rymd & kratrar",
            "nc_selected_setup": "Vald uppsättning",
            
            "btn_start_build": "🚀 BÖRJA BYGGA",
            
            // Editor / Arcade
            "save": "Spara",
            "saved": "Sparad",
            "saving": "Sparar...",
            "ed_test_course": "Testspela",
            "test_course": "Testspela",
            "ed_build_mode": "Bygg",
            "ed_save_draft": "Spara utkast",
            "ed_publish": "Publicera",
            "ed_undo": "Ångra",
            "ed_redo": "Gör om",
            "ed_clear": "Rensa bana",
            "tab_tools": "Verktyg",
            "tab_env": "Miljö",
            "tab_map": "Karta",
            "sculpt_tools_header": "Forma terräng",
            "tool_inspect": "Markera",
            "tool_course": "Hål",
            "tool_spline": "Staket & Murar",
            "tool_hole": "Range",
            "tool_sculpt": "Forma",
            "tool_paint": "Måla yta",
            "tool_water": "Vatten",
            "tool_props": "Objekt",
            "tool_env": "Miljö",
            "tool_block": "Byggblock",
            "tool_measure": "Mät avstånd",
            "tool_eraser": "Radera",
            "tool_undo": "Ångra",
            "tool_redo": "Gör om",
            "tool_grid": "Rutnät",
            "tool_rings": "Ringar",
            "tool_pro_mode": "Pro-läge",
            "tool_basic_mode": "Bas-läge",
            "sub_sculpt": "Forma",
            "sub_smooth": "Jämna ut",
            "sub_mtn": "Berg",
            "sub_flatten": "Platta till",
            "sub_ramp": "Ramp",
            "sub_ridge": "Ås",
            "sub_noise": "Kupering",

            // Flyout Navigation
            "flyout_objects_header": "Objekt & Dekoration",
            "flyout_obj_trees": "Träd",
            "flyout_obj_plants": "Buskar & Växter",
            "flyout_obj_rocks": "Stenar",
            "flyout_obj_fences": "Staket & Murar",
            "flyout_obj_blocks": "Byggblock",
            "flyout_obj_colorize": "Färga",
            "flyout_sculpt_header": "Forma Terräng",
            "flyout_env_header": "Miljö & Atmosfär",
            "flyout_env_sun": "Ljus & Tid",
            "flyout_env_weather": "Väder & Vind",
            "flyout_env_surround": "Horisont & Hav",
            "flyout_env_grass": "3D-Gräs & Partiklar",

            // Environment Panels
            "env_sun_header": "Ljus & Tid på dygnet",
            "env_sun_pos": "Solposition",
            "env_quick_select": "Snabbval",
            "env_dawn": "🌅 Gryning",
            "env_day": "☀️ Dag",
            "env_golden": "🌇 Gyllene",
            "env_night": "🌙 Natt",
            "env_fog": "Dimma (Fog Density)",
            "env_fog_clear": "Klar sikt",
            "env_fog_dense": "Tät dimma",
            "env_weather_header": "Väder & Vind",
            "env_weather_label": "Väderlek",
            "env_wind_speed": "Vindstyrka",
            "env_wind_calm": "Stiltje (0)",
            "env_wind_storm": "Storm (30 mph)",
            "env_wind_dir": "Vindriktning",
            "env_surround_header": "Omgivande Horisont",
            "env_surround_desc": "Välj vad som möter ögat vid banans kanter. Sparas automatiskt med hålet.",
            "env_surround_north": "Norr (N)",
            "env_surround_east": "Öster (E)",
            "env_surround_south": "Söder (S)",
            "env_surround_west": "Väster (W)",
            "env_surround_blend": "Övergång till horisont",
            "env_blend_soft": "Mjuk toning",
            "env_blend_sharp": "Skarp gräns",
            "env_grass_header": "3D-Gräs & Partiklar",
            "env_grass_3d": "Volumetriskt 3D-Gräs",
            "env_grass_rough_h": "Rough Höjd",
            "env_grass_deep_h": "Deep Rough Höjd",
            "env_particles_label": "Partiklar (Löv & Pollen)",
            "env_particles_none": "Inga",
            "env_particles_max": "Maximalt",
            "env_particle_size": "Partikelstorlek",
            "env_particle_tiny": "Små",
            "env_particle_huge": "Stora",

            // Weather options
            "weather_clear": "☀️ Klart / Soligt",
            "weather_overcast": "☁️ Mulet / Molnigt",
            "weather_drizzle": "🌦️ Lätt duggregn",
            "weather_rain": "🌧️ Regn",
            "weather_storm": "⛈️ Åskoväder / Storm",
            "weather_fog": "🌫️ Tät dimma",

            // Horizon options
            "surr_opt_none": "❌ Ingen",
            "surr_opt_rough": "🟢 Rough",
            "surr_opt_waste": "🟡 Waste / Sand",
            "surr_opt_fescue": "🌲 Deep Rough",
            "surr_opt_water": "💧 Insjö (Water)",
            "surr_opt_ocean": "🌊 Hav (Ocean)",
            "surr_opt_horizon": "🌫️ Bergshorisont",
            "surr_opt_sky": "⛅ Himmel (Sky)",

            // Spline (Fences & Walls)
            "spline_header": "Staket & Murar",
            "spline_desc": "Klicka och rita en linje på marken för att bygga staket, murar eller häckar längs kurvan.",
            "spline_choose_type": "Välj Typ",
            "spline_wood_fence": "Trästaket",
            "spline_stone_wall": "Stenmur",
            "spline_ob_stakes": "OB-pinnar",
            "spline_hedge": "Häck",
            "spline_clear": "❌ Rensa ritad linje",

            // Hole Builder (Smart Builder)
            "flyout_holes_header": "Hålbyggare",
            "sb_type_green": "Green",
            "sb_type_fairway": "Fairway",
            "sb_type_bunker": "Bunker",
            "sb_type_tee": "Tee",
            "sb_type_aim": "Sikte (Aim)",
            "sb_green_header": "Green & Klippning",
            "sb_fairway_header": "Fairway & Rough",
            "sb_bunker_header": "Bunker & Sand",
            "sb_tee_header": "Tee Box & Markörer",
            "sb_aim_header": "Siktpunkt & Riktlinje",
            "sb_build_green": "⛳ Bygg Green",
            "sb_build_fairway": "🏌️ Bygg Fairway",
            "sb_build_bunker": "🏖️ Bygg Bunker",
            "sb_build_tee": "🟦 Bygg Tee Box",
            "sb_clear_points": "❌ Rensa ritad linje",
            "sb_contour": "Kontur",
            "sb_foregreen": "Foregreen",
            "sb_green_active": "Aktiv Green",
            "sb_adopt_green": "✨ Gör greenen redigerbar (Live Studio)",
            "sb_existing_green_found": "⛳ Befintlig green upptäckt",
            "sb_elevation_offset": "Green-höjd",
            "sb_blend_distance": "Släntövergång",
            "sb_move_green": "✥ Flytta green",
            "sb_delete_green": "🗑️ Radera green",
            "sb_redraw_green": "🔄 Justera form",
            "sb_adjust_shape": "🔄 Justera form",
            "sb_move_flag": "🎯 Flytta flagga",
            "sb_studio_locked_hint": "🔒 Live Studio aktiveras när greenen är byggd",
            "sb_draw_min_points_hint": "✏️ Klicka på marken för att rita greenens form (minst 3 punkter)",
            "sb_scale_title": "Green-storlek (Skala)",
            "sb_scale_down": "Minska (-10%)",
            "sb_scale_up": "Öka (+10%)",
            "sb_raised_green": "Upphöjd Green (valfritt)",
            "sb_surround_h": "Omgivningshöjd",
            "sb_surround_r": "Omgivningsradie",
            "sb_tilt_aim": "Tilt → Siktpunkt",
            "sb_mow_pattern": "Klippmönster",
            "sb_edge": "Kantskärpa",
            "sb_bunker_depth": "Djup",
            "sb_bunker_lip": "Vall / Lip",
            "sb_bunker_shape": "Form",
            "sb_bunker_plural": "Bunkrar",
            "sb_new_bunker": "➕ Ny Bunker",
            "sb_bunker_item": "Bunker",
            "sb_bunker_active": "Aktiv Bunker",
            "sb_find_bunker": "🔍 Hitta på kartan",
            "sb_move_bunker": "✥ Flytta bunker",
            "sb_redraw_bunker": "🔄 Justera form",
            "sb_delete_bunker": "🗑️ Radera bunker",
            "sb_delete_all_bunkers": "🗑️ Radera alla bunkrar",
            "sb_scale_bunker_title": "Bunker-storlek (Skala)",
            "sb_bunker_outline_visible": "👁️ Gul kontur: Synlig",
            "sb_bunker_outline_hidden": "👁️‍🗨️ Gul kontur: Dold",
            "sb_bunker_draw_min_points_hint": "✏️ Klicka på marken för att rita bunkerns form (minst 3 punkter)",
            "sb_bunker_studio_locked_hint": "🔒 Live Studio aktiveras när bunkern är byggd",
            "sbk_tab_form": "1. Form",
            "sbk_tab_profil": "2. Profil & Vall",
            "sbk_tab_sand": "3. Sand & Finish",
            "sbk_step_draw_hint": "Klicka för att sätta golfbollar. Dra valfri boll för att justera formen. Högerklicka för att radera.",
            "sbk_tip_drag": "💡 <b>Dra</b> de stora vita golfbollarna för att ändra form. <b>Klicka på den gula linjen</b> för att lägga till punkt, <b>högerklicka</b> för att ta bort.",
            "sbk_selected_badge": "● Bunker vald",
            "sbk_step2_btn": "Steg 2: Justera djup & vall ➔",
            "sbk_step3_btn": "Steg 3: Sandfärg & finish ➔",
            "sbk_finish_btn": "✔ Klar med bunkern!",
            "sbk_models": "Bunkermallar",
            "sbk_preset_bowl": "Skålad",
            "sbk_preset_pot": "Pot Bunker",
            "sbk_preset_flat": "Platt botten",
            "sbk_preset_waste": "Waste Bunker",
            "sbk_lip_direction": "Vallriktning",
            "sbk_lip_to_flag": "🚩 Mot flaggan",
            "sbk_reset_profile": "↺ Återställ profil",
            "sbk_sand_type": "Sandtyp & Färg",
            "sbk_sand_augusta": "Augusta Vit",
            "sbk_sand_augusta_sub": "Kvartssand",
            "sbk_sand_golden": "Gyllene Sand",
            "sbk_sand_golden_sub": "Klassisk park",
            "sbk_sand_links": "Skotsk Links",
            "sbk_sand_links_sub": "Gråbrun ton",
            "sbk_sand_coastal": "Kust / Klit",
            "sbk_sand_coastal_sub": "Mjuk sanddyn",
            "sbk_edge_title": "Kantskärpa / Torvkant",
            "sbk_edge_sod": "Skuren torvkant",
            "sbk_edge_soft": "Mjuk sandkant",
            "sb_fairway_terrain": "Terräng",
            "sb_fairway_active": "Aktiv Fairway",
            "sb_new_fairway": "➕ Ny Fairway",
            "sb_fairway_item": "Fairway",
            "sb_fairway_plural": "Fairways",
            "sb_fairway_outline_visible": "👁️ Fairway-kontur: Synlig",
            "sb_fairway_outline_hidden": "👁️‍🗨️ Fairway-kontur: Dold",
            "sb_drawing_new_fairway": "✏️ Ritar ny Fairway...",
            "sb_find_fairway": "🔍 Hitta på kartan",
            "sb_delete_fairway": "🗑️ Radera fairway",
            "sb_delete_all_fairways": "🗑️ Radera alla fairways",
            "sb_clean_ghosts": "🧹 Rensa spök-fairways",
            "sb_redraw_fairway": "🔄 Justera form",
            "sb_scale_fairway_title": "Fairway-storlek (Skala)",
            "sb_move_fairway": "✥ Flytta fairway",
            "sb_fairway_studio_locked_hint": "🔒 Live Studio aktiveras när fairwayen är byggd",
            "sb_fairway_draw_min_points_hint": "✏️ Klicka på marken för att rita fairwayens form (minst 3 punkter)",
            "sf_step_draw": "Rita formen",
            "sf_draw_hint": "Klicka för att sätta ut fairway-punkter. Dra valfri punkt för att justera formen. Högerklicka för att radera.",
            "sf_form_tip": "💡 Dra i 3D-golfbollarna för att skulptera fairwayen. Klicka mellan två bollar på den gröna linjen för att sätta in ett nytt handtag. Högerklicka på en boll för att radera.",
            "sf_area_label": "Areal",
            "sf_to_step2": "Steg 2: Justera rufs & vågor",
            "sf_terrain_profile_title": "Böljande Mark (Terrängprofil)",
            "sf_to_step3": "Steg 3: Klippmönster & finish",
            "sf_finish": "Klar med fairwayen!",
            "gs_step_draw": "Rita formen",
            "gs_draw_hint": "Klicka för att sätta golfbollar. Dra valfri boll för att justera formen. Högerklicka för att radera.",
            "gs_undo_point": "Ångra punkt",
            "gs_reset": "Börja om",
            "gs_create_green": "Skapa green",
            "sb_semi_rough": "Semi-Rough",
            "sb_rough": "Rough",
            "sb_deep_rough": "Tjockruff",
            "sb_surface_type": "Yta / Färg",
            "sb_sand": "Sand",
            "sb_waste": "Waste",
            "sb_ob": "OB",
            "sb_custom": "Egen färg:",
            "sb_use_custom": "Använd egen",
            "sb_edge_hardness": "Penselns kantskärpa",
            "sb_tee_markers": "Teemarkörer",
            "sb_raised_tee": "Upphöjd Tee (valfritt)",
            "sb_aim_instruction": "🎯 Klicka på marken för att sätta sikte",
            "sb_aim_hint": "Klicka igen för att flytta • Högerklick för att ta bort",
            "sb_aim_delete": "🗑️ Ta bort Aim Point",
            "sb_drawing_hint": "Klicka för att sätta punkter. Möt startbollen eller klicka på Bygg.",
            "sb_tee_step1": "Steg 1: Siktpunkt",
            "sb_tee_step2": "Steg 2: Teemarkörer",
            "sb_tee_aim_desc": "Siktpunkten anger spelriktning och vrider teemarkörerna mot fairway.",
            "sb_aim_required": "⚠️ Krävs",
            "sb_aim_set": "✅ Sikte satt",
            "sb_btn_set_aim_txt": "Sätt siktpunkt på kartan",
            "sb_btn_move_aim_txt": "Flytta siktpunkt"
        }
    };

    function getLang() {
        return localStorage.getItem(STORAGE_KEY) || 'sv';
    }

    function t(key) {
        const lang = getLang();
        if (DICTIONARY[lang] && DICTIONARY[lang][key]) {
            return DICTIONARY[lang][key];
        }
        if (DICTIONARY.en[key]) {
            return DICTIONARY.en[key];
        }
        return key;
    }

    function setLanguage(lang) {
        if (!DICTIONARY[lang]) lang = 'en';
        localStorage.setItem(STORAGE_KEY, lang);
        applyToDOM();
        updateSwitcherUI();
        window.dispatchEvent(new CustomEvent('golf_lang_changed', { detail: { lang: lang } }));
    }

    function applyToDOM() {
        const currentLang = getLang();
        document.documentElement.lang = currentLang;

        // Elements with data-i18n
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = t(key);
            if (translation && translation !== key) {
                if (el.getAttribute('data-i18n-html') === 'true') {
                    el.innerHTML = translation;
                } else {
                    el.textContent = translation;
                }
            }
        });

        // Elements with data-i18n-placeholder
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const translation = t(key);
            if (translation && translation !== key) el.placeholder = translation;
        });

        // Elements with data-i18n-title
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            const translation = t(key);
            if (translation && translation !== key) el.title = translation;
        });
    }

    function updateSwitcherUI() {
        const current = getLang();
        document.querySelectorAll('.lang-switcher-btn').forEach(btn => {
            const btnLang = btn.getAttribute('data-lang');
            if (btnLang === current) {
                btn.classList.add('active');
                btn.style.background = '#38bdf8';
                btn.style.color = '#0f172a';
                btn.style.fontWeight = 'bold';
            } else {
                btn.classList.remove('active');
                btn.style.background = 'transparent';
                btn.style.color = '#94a3b8';
                btn.style.fontWeight = 'normal';
            }
        });
    }

    function createSwitcherHTML() {
        const current = getLang();
        return `
            <div class="lang-switcher-container" style="display:inline-flex; align-items:center; background:rgba(30,41,59,0.7); border:1px solid rgba(255,255,255,0.1); border-radius:20px; padding:2px; font-size:11px; backdrop-filter:blur(8px); gap:2px;">
                <span style="padding:0 4px 0 6px; color:#64748b; font-size:12px;">🌐</span>
                <button type="button" class="lang-switcher-btn" data-lang="en" onclick="window.setGolfLanguage('en')" style="background:${current==='en'?'#38bdf8':'transparent'}; color:${current==='en'?'#0f172a':'#94a3b8'}; border:none; padding:4px 8px; border-radius:14px; font-size:11px; cursor:pointer; font-weight:${current==='en'?'bold':'normal'}; transition:all 0.2s;">EN</button>
                <button type="button" class="lang-switcher-btn" data-lang="sv" onclick="window.setGolfLanguage('sv')" style="background:${current==='sv'?'#38bdf8':'transparent'}; color:${current==='sv'?'#0f172a':'#94a3b8'}; border:none; padding:4px 8px; border-radius:14px; font-size:11px; cursor:pointer; font-weight:${current==='sv'?'bold':'normal'}; transition:all 0.2s;">SV</button>
            </div>
        `;
    }

    // Expose globals
    window.t = t;
    window.getGolfLanguage = getLang;
    window.setGolfLanguage = setLanguage;
    window.applyGolfI18n = applyToDOM;
    window.createGolfLangSwitcher = createSwitcherHTML;

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            applyToDOM();
            updateSwitcherUI();
        });
    } else {
        applyToDOM();
        updateSwitcherUI();
    }
})();
