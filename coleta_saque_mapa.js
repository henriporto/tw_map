javascript:
/*
 * Coleta & Saque no mapa (hover)
 * Mundo 144 - BR. Uso: abra o mapa (screen=map) e cole no console (F12),
 * ou adicione na Quickbar. Passe o mouse numa aldeia -> mostra a MAIOR
 * coleta diaria e o MAIOR saque diario do dono, com a data de cada recorde.
 * So LE paginas (ranking + village.txt/player.txt). Nao envia nada.
 * Busca so quando voce para o mouse em cima (com cache por jogador).
 */
(function () {
    'use strict';

    if (location.href.indexOf('screen=map') < 0) {
        window.location.assign(game_data.link_base_pure + 'map');
        return;
    }

    // ===== config =====
    var CACHE_TXT_MS  = 12 * 60 * 60 * 1000; // village/player.txt: recarrega a cada 12h
    var CACHE_RANK_MS = 60 * 60 * 1000;      // ranking por jogador: cache 1h
    var HOVER_DELAY   = 250;                 // ms que o mouse precisa ficar parado antes de buscar

    // ===== estado =====
    var villageOwner = {}; // id_aldeia -> {p:playerId, x, y}
    var playerName   = {}; // id_jogador -> nome
    var rankCache    = {}; // id_jogador -> {t, coleta, coletaData, saque, saqueData}
    var ready = false, hoverTimer = null, currentVid = null;

    // ===== estimativa de tropas a partir da coleta (modelo calibrado ~94%) =====
    // Tabela coleta/dia -> capacidade de carga (pre-calculada; a coleta satura,
    // entao acima do topo so da pra dizer "no minimo").
    var CAL_D=[2211,2644,3172,3748,4428,5236,6167,7233,8499,9929,11584,13433,15497,17776,20265,23031,26090,29457,33121,37043,41198,45529,50087,54967,60142,65561,71170,76901,82694,88487,94226,99865,105372,110724,115907,120918,125761,130446,134984,139392];
    var CAL_C=[50,61,75,91,111,136,166,202,247,301,368,449,548,669,817,998,1218,1487,1816,2217,2707,3304,4034,4925,6013,7341,8963,10942,13359,16310,19913,24311,29681,36237,44241,54012,65942,80508,98290,120000];
    // retorna capacidade estimada, ou null se saturado (coleta acima do teto do modelo)
    function capFromColeta(D) {
        if (D == null || D <= 0) return undefined;
        if (D <= CAL_D[0]) return CAL_C[0] * D / CAL_D[0];
        if (D >= CAL_D[CAL_D.length - 1]) return null; // saturado
        var i = 0; while (CAL_D[i + 1] < D) i++;
        var t = (Math.log(D) - Math.log(CAL_D[i])) / (Math.log(CAL_D[i + 1]) - Math.log(CAL_D[i]));
        return Math.exp(Math.log(CAL_C[i]) + t * (Math.log(CAL_C[i + 1]) - Math.log(CAL_C[i])));
    }
    function r10(n) { return Math.round(n / 10) * 10; }
    function troopLine(coleta) {
        var c = capFromColeta(coleta);
        if (c === undefined) return '';
        if (c === null) {
            var top = CAL_C[CAL_C.length - 1];
            return '<br>🪖 <b>≥' + top.toLocaleString('pt-BR') + '</b> cap · ≥' +
                   r10(top / 25).toLocaleString('pt-BR') + ' lança <span style="opacity:.6">(coletador no teto)</span>';
        }
        var cap = Math.round(c);
        var soft = cap >= 60000 ? ' <span style="opacity:.6">(impreciso)</span>' : '';
        return '<br>🪖 <b>~' + cap.toLocaleString('pt-BR') + '</b> cap · ~' +
               r10(cap / 25).toLocaleString('pt-BR') + ' lança · ~' +
               r10(cap / 80).toLocaleString('pt-BR') + ' cav' + soft;
    }

    // ===== CSV simples =====
    function csv(text) {
        var out = [], lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) if (lines[i]) out.push(lines[i].split(','));
        return out;
    }

    // ===== carregar .txt com cache em localStorage =====
    function getTxt(path, key, cb) {
        var now = Date.now();
        var ts = parseInt(localStorage.getItem(key + '_t') || '0', 10);
        var cached = localStorage.getItem(key);
        if (cached && now < ts + CACHE_TXT_MS) { cb(cached); return; }
        $.get(path, function (data) {
            try { localStorage.setItem(key, data); localStorage.setItem(key + '_t', '' + now); } catch (e) {}
            cb(data);
        }).fail(function () { cb(cached || ''); });
    }

    function init() {
        setTip('Coleta/Saque: carregando dados do mundo...');
        getTxt('/map/village.txt', 'csq_vill', function (vt) {
            var v = csv(vt);
            for (var i = 0; i < v.length; i++) {
                if (v[i].length < 5) continue; // 0=id 1=nome 2=x 3=y 4=player 5=pts 6=bonus
                villageOwner[v[i][0]] = { p: v[i][4], x: v[i][2], y: v[i][3] };
            }
            getTxt('/map/player.txt', 'csq_play', function (pt) {
                var p = csv(pt);
                for (var j = 0; j < p.length; j++) {
                    if (p[j].length < 2) continue; // 0=id 1=nome(urlenc)
                    var nm = p[j][1];
                    try { nm = decodeURIComponent(nm.replace(/\+/g, ' ')); } catch (e) {}
                    playerName[p[j][0]] = nm;
                }
                ready = true;
                setTip('Coleta/Saque pronto ✓ passe o mouse numa aldeia.');
                setTimeout(hideTip, 2500);
                console.log('[Coleta/Saque] pronto:', Object.keys(villageOwner).length, 'aldeias,',
                            Object.keys(playerName).length, 'jogadores');
            });
        });
    }

    // ===== tooltip =====
    var tip;
    function ensureTip() {
        if (tip) return tip;
        tip = document.createElement('div');
        tip.id = 'csqTip';
        tip.style.cssText = 'position:fixed;z-index:99999;max-width:270px;padding:6px 9px;' +
            'background:#2b2a26;color:#f4e4bc;border:1px solid #000;border-radius:4px;font-size:12px;' +
            'line-height:1.4;box-shadow:0 2px 8px rgba(0,0,0,.5);pointer-events:none;display:none;';
        document.body.appendChild(tip);
        return tip;
    }
    function setTip(html) { ensureTip(); tip.innerHTML = html; tip.style.display = 'block'; }
    function hideTip() { if (tip) tip.style.display = 'none'; }
    function moveTip(e) {
        if (!tip || tip.style.display === 'none') return;
        var x = e.clientX + 16, y = e.clientY + 16;
        if (x + tip.offsetWidth  > innerWidth)  x = e.clientX - tip.offsetWidth  - 16;
        if (y + tip.offsetHeight > innerHeight) y = e.clientY - tip.offsetHeight - 16;
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
    }

    // ===== helpers =====
    function fmt(n) { return (n == null) ? '—' : n.toLocaleString('pt-BR'); }
    function shortDate(d) { return d ? d.replace(/\.(\d{4})$/, '') : ''; } // 22.09.2026 -> 22.09
    function vidFromEl(el) {
        if (!el || !el.id) return null;
        var m = el.id.match(/^map_(?:village|cmdicons)_(\d+)/);
        return m ? m[1] : null;
    }

    // ===== parse do ranking "Em um dia" =====
    function parseRank(html, pid) {
        var m = html.match(/id="in_a_day_ranking_table"[\s\S]*?<\/table>/);
        if (!m) return [null, null];
        var rows = m[0].match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (r.indexOf('<th') >= 0) continue;
            var idm = r.match(/screen=info_player&amp;id=(\d+)/);
            if (!idm || idm[1] !== String(pid)) continue;
            var tds = r.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
            if (tds.length < 5) return [null, null];
            var val = parseInt(tds[3].replace(/<[^>]+>/g, '').replace(/[^\d]/g, ''), 10);
            var dat = tds[4].replace(/<[^>]+>/g, '').trim();
            return [isNaN(val) ? null : val, dat];
        }
        return [null, null];
    }

    function rankUrl(type, name) {
        return '/game.php?village=' + game_data.village.id +
               '&screen=ranking&mode=in_a_day&type=' + type +
               '&name=' + encodeURIComponent(name);
    }

    function fetchPlayer(pid, name, done) {
        var c = rankCache[pid];
        if (c && Date.now() < c.t + CACHE_RANK_MS) { done(c); return; }
        var got = {}, n = 0;
        function chk() {
            if (++n < 2) return;
            rankCache[pid] = {
                t: Date.now(),
                coleta: got.sc ? got.sc[0] : null, coletaData: got.sc ? got.sc[1] : null,
                saque:  got.lo ? got.lo[0] : null, saqueData:  got.lo ? got.lo[1] : null
            };
            done(rankCache[pid]);
        }
        $.get(rankUrl('scavenge', name)).done(function (h) { got.sc = parseRank(h, pid); }).always(chk);
        $.get(rankUrl('loot_res', name)).done(function (h) { got.lo = parseRank(h, pid); }).always(chk);
    }

    function render(name, coord, res, loading) {
        var cole = loading ? '...' : fmt(res.coleta);
        var saqu = loading ? '...' : fmt(res.saque);
        return '<b>' + name + '</b> <span style="opacity:.6">' + coord + '</span>' +
            '<hr style="border:none;border-top:1px solid #555;margin:4px 0">' +
            '🪣 Coleta: <b>' + cole + '</b>' +
            (!loading && res.coletaData ? ' <span style="opacity:.6">(' + shortDate(res.coletaData) + ')</span>' : '') +
            '<br>💰 Saque: <b>' + saqu + '</b>' +
            (!loading && res.saqueData ? ' <span style="opacity:.6">(' + shortDate(res.saqueData) + ')</span>' : '') +
            (loading ? '' : troopLine(res.coleta));
    }

    // ===== deteccao da aldeia sob o cursor =====
    // O mapa tem uma camada #map_mover (z-index 12, cursor:move) por cima que
    // captura o mouse, entao os <img> de aldeia NAO recebem mouseover.
    // Solucao: elementsFromPoint enxerga os elementos por baixo dessa camada.
    function showForVillage(vid) {
        if (!ready) { setTip('Carregando lista de aldeias...'); return; }
        var ow = villageOwner[vid];
        if (!ow) { setTip('Aldeia ' + vid + ' (fora do village.txt em cache)'); return; }
        var coord = ow.x + '|' + ow.y;
        if (ow.p === '0' || !ow.p) { setTip('<b>Bárbara</b> <span style="opacity:.6">' + coord + '</span>'); return; }
        var name = playerName[ow.p] || ('Jogador ' + ow.p);
        setTip(render(name, coord, {}, true));
        fetchPlayer(ow.p, name, function (res) {
            if (currentVid !== vid) return;
            setTip(render(name, coord, res, false));
        });
    }

    var lastHit = 0;
    function onMove(e) {
        moveTip(e);
        var now = Date.now();
        if (now - lastHit < 60) return; // throttle do hit-test
        lastHit = now;
        var vid = null, els = document.elementsFromPoint(e.clientX, e.clientY);
        for (var i = 0; i < els.length; i++) { var v = vidFromEl(els[i]); if (v) { vid = v; break; } }
        if (vid === currentVid) return;
        currentVid = vid;
        clearTimeout(hoverTimer);
        if (vid === null) { hideTip(); return; }
        hoverTimer = setTimeout(function () {
            if (currentVid === vid) showForVillage(vid);
        }, HOVER_DELAY);
    }

    document.addEventListener('mousemove', onMove, true);

    init();
    console.log('[Coleta/Saque no mapa] iniciado');
})();
