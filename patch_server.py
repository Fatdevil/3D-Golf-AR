import re

with open('c:/Antigravety projekt/3D-Golf-AR/server.js', 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace(
    '''await pool.query(ALTER TABLE courses ADD COLUMN theme_data JSONB DEFAULT '{}';);
            console.log("Database Migration: Added theme_data to courses");
        } catch (e) {
            // Kolumnen finns troligen redan
        }''',
    '''await pool.query(ALTER TABLE courses ADD COLUMN theme_data JSONB DEFAULT '{}';);
            console.log("Database Migration: Added theme_data to courses");
        } catch (e) {}

        try {
            await pool.query(ALTER TABLE courses ADD COLUMN cover_image TEXT;);
            console.log("Database Migration: Added cover_image to courses");
        } catch (e) {}'''
)

c = c.replace(
    'SELECT share_code, name, author, likes, hole_count, total_par, play_count, owner_id, version, created_at \\n            FROM courses',
    'SELECT share_code, name, author, likes, hole_count, total_par, play_count, owner_id, version, created_at, cover_image \\n            FROM courses'
)

c = c.replace(
    'total_par, new_version } = req.body;',
    'total_par, new_version, cover_image } = req.body;'
)

c = c.replace(
    '''is_draft=, theme_data=, is_range=, hole_count=, total_par=,
                     updated_at=CURRENT_TIMESTAMP ''',
    '''is_draft=, theme_data=, is_range=, hole_count=, total_par=, cover_image=,
                     updated_at=CURRENT_TIMESTAMP '''
)

c = c.replace(
    '''c_hole_count, c_total_par
                ]''',
    '''c_hole_count, c_total_par, cover_image || null
                ]'''
)

c = c.replace(
    '''course_rating, slope_rating, stroke_index) 
            VALUES (, , , , , , , , , , , , , , , , ) RETURNING share_code''',
    '''course_rating, slope_rating, stroke_index, cover_image) 
            VALUES (, , , , , , , , , , , , , , , , , ) RETURNING share_code'''
)

c = c.replace(
    '''calculateCourseRating(holes, c_total_par), calculateSlopeRating(holes), JSON.stringify(calculateStrokeIndex(holes))
            ]''',
    '''calculateCourseRating(holes, c_total_par), calculateSlopeRating(holes), JSON.stringify(calculateStrokeIndex(holes)), cover_image || null
            ]'''
)

with open('c:/Antigravety projekt/3D-Golf-AR/server.js', 'w', encoding='utf-8') as f:
    f.write(c)

print('Patched server.js')
