// The plates of a collection round after the round has started (no browser needed to test it). A round is played one plate per page; the order of the
// plates is kept from the start, so editing the collection meanwhile (another tab, another device) does not send the player the wrong way.
// But a result only counts for a collection while the same plates are in it and the plates already played are still the versions that were played.
(function (root) {
    'use strict';

    const codeOf = p => String(typeof p === 'string' ? p : (p && p.plate_code) || '').toUpperCase();

    // o: { frozen: the plates in the order of the start, versions: { CODE: version } at the start (or null), collection: the collection as it is now
    //      (with plate_versions { CODE: version } when the server tells), plateIndex, courseCode }
    // Returns { plates, changed }: the plates to go on with, and whether the course is no longer the one that was started.
    //   changed: a plate was taken out or replaced, or a plate already played has been published again since
    //   without a usable start (nothing kept, or this page is not in it) the collection is taken as it is now
    function continueRound(o) {
        const col = o.collection, now = (col && col.plates) || [];
        const frozen = o.frozen;
        if (!Array.isArray(frozen) || frozen.length <= o.plateIndex || !frozen[o.plateIndex] || codeOf(frozen[o.plateIndex]) !== String(o.courseCode).toUpperCase()) {
            return { plates: now, changed: false };
        }
        const nowCodes = now.map(codeOf);
        if (frozen.length !== nowCodes.length || !frozen.every(p => nowCodes.indexOf(codeOf(p)) >= 0)) return { plates: now, changed: true };
        const then = o.versions, cur = col.plate_versions;
        if (then && cur) {
            for (let i = 0; i < o.plateIndex; i++) {
                const c = codeOf(frozen[i]);
                if (then[c] !== undefined && cur[c] !== undefined && then[c] !== cur[c]) return { plates: now, changed: true };
            }
        }
        return { plates: frozen, changed: false };
    }

    const api = { codeOf: codeOf, continueRound: continueRound };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CollectionRound = api;
})(typeof window !== 'undefined' ? window : this);
