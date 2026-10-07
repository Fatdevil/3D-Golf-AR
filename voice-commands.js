// Voice commands for the builder (Swedish and English): say "ändra green" / "change green" and the same thing happens as when the button is pressed.
// Speech to text is done by the browser (Web Speech API); this file turns the text into a command and runs it.
// parse() is pure (no DOM) so it can be tested in node: tests/test_voice_commands.js.
(function (root) {
    'use strict';

    // "Ändra green" -> "andra green": accents and case are dropped so that what the recogniser writes in either language matches.
    function normalize(text) {
        return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // Order matters: the more specific phrases first ("spara och spela" before "spara", components before tools).
    const RULES = [
        { re: /\b(hjalp|help|kommandon|commands|what can i say|vad kan jag saga)\b/, cmd: { action: 'help' } },
        { re: /\b(sluta lyssna|stoppa rosten|stop listening|microphone off|mikrofon av)\b/, cmd: { action: 'stop' } },
        // leaving the builder needs the whole phrase, so a stray word never starts a round
        { re: /\b(spara och spela|spara och testa|spela banan|testa banan|save and play|play the course|play course|test the course|test course)\b/, cmd: { action: 'saveplay' } },
        { re: /\b(angra|undo)\b/, cmd: { action: 'undo' } },
        { re: /\b(gor om|gora om|redo)\b/, cmd: { action: 'redo' } },
        { re: /\b(nasta|next)\b.*\b(hal|hole)\b|\b(hal|hole)\b.*\b(nasta|next)\b/, cmd: { action: 'hole', value: 1 } },
        { re: /\b(foregaende|forra|previous|prior)\b.*\b(hal|hole)\b|\b(hal|hole)\b.*\b(foregaende|forra|previous|prior)\b/, cmd: { action: 'hole', value: -1 } },
        { re: /\b(spara|save)\b/, cmd: { action: 'save' } },
        // the parts of a hole: opens the same menu as the button in the hole flyout
        { re: /\b(green|greens|greenen|greenar)\b/, cmd: { action: 'component', value: 'GREEN' } },
        { re: /\b(fairway|fairways|fairwayen|fair way|fairwayn)\b/, cmd: { action: 'component', value: 'FAIRWAY' } },
        { re: /\b(bunker|bunkers|bunkern|bunkrar|bunkrarna|sandbunker|sandfalla)\b/, cmd: { action: 'component', value: 'BUNKER' } },
        { re: /\b(tee|tees|teen|teebox|teeboxen|tee box|utslag|utslagsplats|utslagsplatsen)\b/, cmd: { action: 'component', value: 'TEE' } },
        // the tools in the left toolbar
        { re: /\b(smart builder|smartbuilder|course builder|hole builder|hole tool|build hole|banbyggare|bygg hal|hal verktyget|hal verktyg)\b/, cmd: { action: 'tool', value: 'SMART_BUILDER' } },
        { re: /\b(markera|inspect|inspektera|inspection)\b/, cmd: { action: 'tool', value: 'INSPECT' } },
        { re: /\b(forma|sculpt|sculpting|skulptera|terrang|terrain)\b/, cmd: { action: 'tool', value: 'SCULPT' } },
        { re: /\b(mala|paint|painting)\b/, cmd: { action: 'tool', value: 'PAINT' } },
        { re: /\b(vatten|water|sjo|lake)\b/, cmd: { action: 'tool', value: 'WATER' } },
        { re: /\b(objekt|objects|props|trad|trees|decoration|dekoration)\b/, cmd: { action: 'tool', value: 'PROPS' } },
        { re: /\b(miljo|environment|sky|himmel|vader|weather)\b/, cmd: { action: 'tool', value: 'ENV' } }
    ];

    // Returns { action, value? } or null when the text holds no command.
    function parse(text) {
        const t = normalize(text);
        if (!t) return null;
        for (let i = 0; i < RULES.length; i++) {
            if (RULES[i].re.test(t)) return Object.assign({}, RULES[i].cmd);
        }
        return null;
    }

    const NAMES = {
        sv: { GREEN: 'Green', FAIRWAY: 'Fairway', BUNKER: 'Bunker', TEE: 'Tee', SMART_BUILDER: 'Hål', INSPECT: 'Markera', SCULPT: 'Forma', PAINT: 'Måla', WATER: 'Vatten', PROPS: 'Objekt', ENV: 'Miljö' },
        en: { GREEN: 'Green', FAIRWAY: 'Fairway', BUNKER: 'Bunker', TEE: 'Tee', SMART_BUILDER: 'Hole', INSPECT: 'Inspect', SCULPT: 'Sculpt', PAINT: 'Paint', WATER: 'Water', PROPS: 'Objects', ENV: 'Environment' }
    };
    const TEXT = {
        sv: { heard: 'Hörde', none: 'inget kommando', undo: 'Ångra', redo: 'Gör om', next: 'Nästa hål', prev: 'Föregående hål', saved: 'Sparat', saveFailed: 'Kunde inte spara just nu', micFailed: 'Röstigenkänningen fungerar inte här (mikrofon eller språk saknas)', play: 'Sparar och spelar…', off: 'Röststyrning av',
              notBuild: 'Röstkommandon fungerar i byggläget', unsupported: 'Den här webbläsaren stöder inte röstigenkänning (prova Chrome eller Safari)', denied: 'Mikrofonen är blockerad. Tillåt den i webbläsarens inställningar',
              help: 'Säg: ändra green · fairway · bunker · tee · forma · måla · vatten · objekt · miljö · ångra · gör om · nästa hål · föregående hål · spara · spara och spela', on: 'Lyssnar…', mic: 'Röststyrning' },
        en: { heard: 'Heard', none: 'no command', undo: 'Undo', redo: 'Redo', next: 'Next hole', prev: 'Previous hole', saved: 'Saved', saveFailed: 'Could not save right now', micFailed: 'Speech recognition does not work here (no microphone or language)', play: 'Saving and playing…', off: 'Voice control off',
              notBuild: 'Voice commands work in build mode', unsupported: 'This browser does not support speech recognition (try Chrome or Safari)', denied: 'The microphone is blocked. Allow it in the browser settings',
              help: 'Say: change green · fairway · bunker · tee · sculpt · paint · water · objects · environment · undo · redo · next hole · previous hole · save · save and play', on: 'Listening…', mic: 'Voice control' }
    };

    const api = { parse: parse, normalize: normalize, rules: RULES.length };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (!root || !root.document) return;

    // ───────────── browser part ─────────────
    const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
    let lang = 'sv';
    try { lang = localStorage.getItem('golf_voice_lang') || (localStorage.getItem('golf_os_lang') === 'en' ? 'en' : 'sv'); } catch (e) {}
    let rec = null, listening = false, idleTimer = null, restartTimer = null, btn = null, chip = null, langBtn = null;
    const IDLE_MS = 90000;

    const tx = function (k) { return (TEXT[lang] || TEXT.sv)[k]; };
    function inBuildMode() { try { return typeof appMode !== 'undefined' && (appMode === 'BUILD' || appMode === 'ARCHITECT'); } catch (e) { return false; } }
    function toast(msg, color) {
        if (typeof root.showBuildToast === 'function') root.showBuildToast(msg, color || '#38bdf8');
        else if (chip) { chip.textContent = msg; }
    }
    function say(text) { if (chip) { chip.textContent = text; chip.style.opacity = text ? '1' : '0'; } }
    function paint() {
        if (!btn) return;
        btn.setAttribute('aria-pressed', listening ? 'true' : 'false');
        btn.classList.toggle('voice-on', listening);
        btn.title = tx('mic') + (listening ? ' — ' + tx('on') : '');
        btn.setAttribute('aria-label', btn.title);
        if (langBtn) { langBtn.textContent = lang.toUpperCase(); langBtn.title = lang === 'sv' ? 'Svenska — tryck för English' : 'English — tap for Svenska'; }
    }

    function run(cmd) {
        const names = NAMES[lang] || NAMES.sv;
        if (cmd.action === 'help') { toast(tx('help'), '#475569'); return true; }
        if (cmd.action === 'stop') { stop(); return true; }
        if (!inBuildMode()) { toast(tx('notBuild'), '#ef4444'); return false; }
        switch (cmd.action) {
            case 'component':
                if (typeof root.selectHoleComponent !== 'function') return false;
                root.selectHoleComponent(cmd.value); toast('🎙️ ' + names[cmd.value]); return true;
            case 'tool':
                if (typeof root.setTool !== 'function' && typeof setTool !== 'function') return false;
                (root.setTool || setTool)(cmd.value); toast('🎙️ ' + names[cmd.value]); return true;
            case 'undo': if (typeof root.performUndo === 'function') { root.performUndo(); toast('🎙️ ' + tx('undo')); return true; } return false;
            case 'redo': if (typeof root.performRedo === 'function') { root.performRedo(); toast('🎙️ ' + tx('redo')); return true; } return false;
            case 'hole':
                if (typeof root.changeHole !== 'function') return false;
                root.changeHole(cmd.value); if (typeof root.updateSBHoleDisplay === 'function') root.updateSBHoleDisplay();
                toast('🎙️ ' + (cmd.value > 0 ? tx('next') : tx('prev'))); return true;
            case 'save':
                if (typeof root.saveQuickDraft !== 'function') return false;
                // saved is only announced once the write is done (saveLevel gives null while the course is still loading, and a write can fail)
                Promise.resolve().then(function () { return root.saveQuickDraft(); })
                    .then(function (r) { toast(r ? '🎙️ ' + tx('saved') : '🎙️ ' + tx('saveFailed'), r ? '#10b981' : '#ef4444'); })
                    .catch(function () { toast('🎙️ ' + tx('saveFailed'), '#ef4444'); });
                return true;
            case 'saveplay': if (typeof root.saveAndPlay === 'function') { toast('🎙️ ' + tx('play'), '#10b981'); root.saveAndPlay(); return true; } return false;
        }
        return false;
    }

    // handles one finished phrase: the recogniser's alternatives are tried in order until one holds a command
    function handleResult(alternatives) {
        for (let i = 0; i < alternatives.length; i++) {
            const cmd = parse(alternatives[i]);
            if (cmd) { say('“' + alternatives[i].trim() + '”'); armIdle(); return run(cmd); }
        }
        const first = alternatives[0] ? alternatives[0].trim() : '';
        if (first) { say(tx('heard') + ': “' + first + '” — ' + tx('none')); }
        return false;
    }

    function armIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(function () { if (listening) { stop(); toast(tx('off'), '#475569'); } }, IDLE_MS); }

    function start() {
        if (!SR) { toast(tx('unsupported'), '#ef4444'); return; }
        if (listening) return;
        listening = true;
        build();
        armIdle(); paint(); say(tx('on'));
    }
    function stop() {
        listening = false;
        clearTimeout(idleTimer); clearTimeout(restartTimer);
        if (rec) { try { rec.onend = null; rec.abort(); } catch (e) {} rec = null; }
        paint(); say('');
    }
    function build() {
        rec = new SR();
        rec.lang = lang === 'en' ? 'en-US' : 'sv-SE';
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 3;
        rec.onresult = function (e) {
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const r = e.results[i];
                if (r.isFinal) {
                    const alts = [];
                    for (let a = 0; a < r.length; a++) alts.push(r[a].transcript);
                    handleResult(alts);
                } else if (r[0]) {
                    say(r[0].transcript);
                }
            }
        };
        rec.onerror = function (e) {
            const err = e && e.error;
            if (!err || err === 'no-speech' || err === 'aborted') return; // a pause or our own stop: the session is simply started again
            // anything else will fail again at once (blocked or missing microphone, language or service not available): turn off instead of retrying
            stop(); toast(err === 'not-allowed' || err === 'service-not-allowed' ? tx('denied') : tx('micFailed'), '#ef4444');
        };
        // the browser ends a session after a pause: start a new one while the button is on
        rec.onend = function () { if (listening) { clearTimeout(restartTimer); restartTimer = setTimeout(function () { if (listening) { try { build(); } catch (er) { stop(); } } }, 250); } };
        try { rec.start(); } catch (e) { stop(); }
    }

    function mount() {
        if (btn || !SR) return;
        const css = document.createElement('style');
        css.textContent = '#voice-ctl{position:fixed;right:14px;bottom:96px;z-index:9000;display:none;align-items:center;gap:6px;font-family:Inter,sans-serif}' +
            'body.voice-build #voice-ctl{display:flex}' +
            '#voice-btn{width:44px;height:44px;border-radius:50%;border:1px solid #334155;background:rgba(15,23,42,.92);color:#cbd5e1;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.35)}' +
            '#voice-btn.voice-on{background:#dc2626;border-color:#fecaca;color:#fff;animation:voicePulse 1.4s ease-in-out infinite}' +
            '#voice-lang{height:28px;min-width:34px;border-radius:14px;border:1px solid #334155;background:rgba(15,23,42,.92);color:#94a3b8;font-size:11px;font-weight:800;cursor:pointer}' +
            '#voice-chip{position:fixed;right:14px;bottom:146px;max-width:min(78vw,340px);z-index:9000;background:rgba(15,23,42,.92);color:#e2e8f0;border:1px solid #334155;border-radius:10px;padding:6px 10px;font-size:12px;opacity:0;transition:opacity .2s;pointer-events:none}' +
            '@keyframes voicePulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.55)}50%{box-shadow:0 0 0 10px rgba(220,38,38,0)}}' +
            '@media (prefers-reduced-motion:reduce){#voice-btn.voice-on{animation:none}}';
        document.head.appendChild(css);
        const wrap = document.createElement('div'); wrap.id = 'voice-ctl';
        langBtn = document.createElement('button'); langBtn.id = 'voice-lang'; langBtn.type = 'button';
        btn = document.createElement('button'); btn.id = 'voice-btn'; btn.type = 'button'; btn.textContent = '🎙️';
        chip = document.createElement('div'); chip.id = 'voice-chip'; chip.setAttribute('aria-live', 'polite');
        wrap.appendChild(langBtn); wrap.appendChild(btn);
        document.body.appendChild(wrap); document.body.appendChild(chip);
        btn.addEventListener('click', function () { listening ? stop() : start(); });
        langBtn.addEventListener('click', function () {
            lang = lang === 'sv' ? 'en' : 'sv';
            try { localStorage.setItem('golf_voice_lang', lang); } catch (e) {}
            const wasOn = listening; if (wasOn) stop();
            paint(); if (wasOn) start();
        });
        paint();
        // the buttons belong to the builder: shown only in build mode, and listening ends when the builder is left
        setInterval(function () {
            const b = inBuildMode();
            document.body.classList.toggle('voice-build', b);
            if (!b && listening) stop();
        }, 700);
    }

    api.start = start; api.stop = stop; api.handle = handleResult; api.supported = !!SR; api.mount = mount;
    root.VoiceCommands = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
