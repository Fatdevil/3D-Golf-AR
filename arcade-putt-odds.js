    // Tour-pro putting odds (percent) by distance in feet, interpolated from PGA Tour make / 3-putt rates
    function tourProPuttOdds(ft) {
        const T = [[0,100,0],[3,96,0],[5,77,0.3],[8,50,0.8],[10,39,1],[15,22,1.8],[20,14,2.5],[30,7,4.5],[40,4,7],[60,2,12],[100,1,20]];
        if (ft <= 0) return { p1: 100, p3: 0 };
        for (let i = 1; i < T.length; i++) {
            if (ft <= T[i][0]) {
                const t = (ft - T[i-1][0]) / (T[i][0] - T[i-1][0]);
                return { p1: T[i-1][1] + (T[i][1] - T[i-1][1]) * t, p3: T[i-1][2] + (T[i][2] - T[i-1][2]) * t };
            }
        }
        return { p1: 1, p3: 20 };
    }
    window.tourProPuttOdds = tourProPuttOdds;
