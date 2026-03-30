/*
 * ═══════════════════════════════════════════
 *  Azure Codex – NPC & Player Tracker
 *  SillyTavern Third-Party Extension
 *  ES6 Module Architecture
 * ═══════════════════════════════════════════
 */

import { getContext, extension_settings, renderExtensionTemplateAsync, saveMetadataDebounced } from '../../../extensions.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { POPUP_TYPE, callGenericPopup } from '../../../popup.js';

// ─── Constants ───
const EXT_NAME   = 'third-party/st-azure-codex';
const META_KEY   = 'azure_codex';
const LOG_PREFIX = '[AzureCodex]';

const DEFAULT_SETTINGS = {
    autoDetect: true,
    autoDetectStats: true,
    showFloatBtn: true,
};

// ═══════════════════════════════════════════
//  STAT DETECTOR – อ่านค่าสแตทจากข้อความบอทอัตโนมัติ
// ═══════════════════════════════════════════
class StatDetector {
    constructor() {
        // ── รูปแบบที่ตรวจจับได้ ──
        // "HP: 80/100", "MP : 50/50", "❤️ HP: 80/100", "[STR: 15]"
        // "HP : 80 / 100", "พลังชีวิต: 80/100", "Gold: 500"
        // "ATK: 25", "DEF: 18", "LV: 5", "EXP: 230/500"
        this._patterns = [
            // Pattern 1: STAT_NAME: VALUE/MAX  (with optional emoji prefix)
            /(?:^|[\s\[\(|•·►▸▹⊳❯»›→⟩☞✦✧✿❖⚔🗡️💎⭐🛡️❤️💙💚💛🔥⚡💧🌟💀👑🎭📊])\s*([A-Za-z\u0E00-\u0E7F\u4E00-\u9FFF]{1,20}(?:\s[A-Za-z\u0E00-\u0E7F\u4E00-\u9FFF]{1,10})?)\s*[:：]\s*(-?\d+(?:\.\d+)?)\s*[\/]\s*(\d+(?:\.\d+)?)/gm,
            // Pattern 2: STAT_NAME: VALUE  (no max, number only)
            /(?:^|[\s\[\(|•·►▸▹⊳❯»›→⟩☞✦✧✿❖⚔🗡️💎⭐🛡️❤️💙💚💛🔥⚡💧🌟💀👑🎭📊])\s*([A-Za-z\u0E00-\u0E7F\u4E00-\u9FFF]{1,20}(?:\s[A-Za-z\u0E00-\u0E7F\u4E00-\u9FFF]{1,10})?)\s*[:：]\s*(-?\d+(?:\.\d+)?)\s*(?=[,\s\]\)|;\n\r]|$)/gm,
        ];

        // ชื่อสแตทที่พบบ่อยใน RPG bot (ใช้จับคู่เพื่อลดผลบวกปลอม)
        this._knownStats = new Set([
            // English
            'hp', 'mp', 'sp', 'tp', 'ep', 'ap', 'wp',
            'str', 'dex', 'agi', 'int', 'wis', 'con', 'cha', 'luk', 'vit', 'end',
            'atk', 'def', 'matk', 'mdef', 'spd', 'eva', 'acc', 'crit',
            'lv', 'level', 'exp', 'gold', 'money', 'coin', 'coins',
            'hunger', 'thirst', 'stamina', 'energy', 'mana', 'health',
            'sanity', 'morale', 'reputation', 'karma', 'luck',
            'attack', 'defense', 'magic', 'speed', 'power',
            'strength', 'agility', 'intelligence', 'wisdom', 'charisma',
            'constitution', 'endurance', 'dexterity', 'vitality',
            'armor', 'damage', 'shield', 'resist', 'resistance',
            // Thai
            'พลังชีวิต', 'พลังเวทย์', 'พลังโจมตี', 'พลังป้องกัน',
            'เลเวล', 'ค่าโจมตี', 'ค่าป้องกัน', 'ความเร็ว',
            'ความหิว', 'ความกระหาย', 'พลังงาน', 'ทอง', 'เงิน',
            'ชื่อเสียง', 'สติ', 'กำลัง', 'ความคล่องตัว', 'สติปัญญา',
        ]);

        // คำที่ไม่ใช่สแตท (false positive)
        this._ignoreWords = new Set([
            'chapter', 'part', 'page', 'line', 'step', 'day', 'year', 'age',
            'score', 'round', 'turn', 'phase', 'act', 'scene', 'episode',
            'room', 'floor', 'no', 'number', 'vol', 'version', 'ver',
            'pm', 'am', 'id', 'ch', 'ep', 'pt',
        ]);
    }

    /**
     * ตรวจจับสแตทจากข้อความ
     * @param {string} text - ข้อความจากบอท
     * @returns {{ [key: string]: { value: number, max: number|null } }}
     */
    detect(text) {
        if (!text || text.length < 3) return {};

        const detected = {};

        // Pattern 1: value/max
        for (const match of text.matchAll(this._patterns[0])) {
            const name = match[1].trim();
            const value = parseFloat(match[2]);
            const max = parseFloat(match[3]);
            if (this._isValidStat(name, value)) {
                detected[name] = { value, max };
            }
        }

        // Pattern 2: value only (skip if already detected with max)
        for (const match of text.matchAll(this._patterns[1])) {
            const name = match[1].trim();
            const value = parseFloat(match[2]);
            if (!detected[name] && this._isValidStat(name, value)) {
                detected[name] = { value, max: null };
            }
        }

        return detected;
    }

    /**
     * ตรวจสอบว่าเป็นสแตทจริง
     */
    _isValidStat(name, value) {
        if (!name || name.length < 2 || name.length > 20) return false;
        const lower = name.toLowerCase();
        if (this._ignoreWords.has(lower)) return false;
        // Accept known stats always, or any stat-like name with reasonable values
        if (this._knownStats.has(lower)) return true;
        // For unknown names, only accept if value looks like a stat (0-99999)
        return Math.abs(value) <= 99999;
    }
}

// ═══════════════════════════════════════════
//  DATA ENGINE – จัดเก็บข้อมูล NPC, Inventory, Player Stats
// ═══════════════════════════════════════════
// SAO-style stat definitions
const SAO_STATS = ['STR', 'AGI', 'VIT', 'INT', 'DEX', 'LUK'];
const POINTS_PER_LEVEL = 5;
const BASE_HP = 100;
const BASE_MP = 50;
const HP_PER_VIT = 15;
const MP_PER_INT = 10;

class DataEngine {
    constructor() {
        this.bots = {};
        this.inventory = [];
        this.player = this._defaultPlayer();
        this._isLoading = false;
    }

    _defaultPlayer() {
        return {
            level: 1, exp: 0, expMax: 100,
            hp: BASE_HP, hpMax: BASE_HP,
            mp: BASE_MP, mpMax: BASE_MP,
            statPoints: 0,
            stats: { STR: 1, AGI: 1, VIT: 1, INT: 1, DEX: 1, LUK: 1 },
        };
    }

    recalcDerived() {
        const p = this.player;
        p.hpMax = BASE_HP + (p.stats.VIT * HP_PER_VIT);
        p.mpMax = BASE_MP + (p.stats.INT * MP_PER_INT);
        p.hp = Math.min(p.hp, p.hpMax);
        p.mp = Math.min(p.mp, p.mpMax);
    }

    levelUp(newLevel) {
        const p = this.player;
        const gained = (newLevel - p.level) * POINTS_PER_LEVEL;
        if (gained > 0) {
            p.statPoints += gained;
            p.level = newLevel;
            p.hp = p.hpMax; // full heal on level up
            p.mp = p.mpMax;
            this.recalcDerived();
            return gained;
        }
        p.level = newLevel;
        return 0;
    }

    allocateStat(statName, amount = 1) {
        const p = this.player;
        if (!SAO_STATS.includes(statName) || p.statPoints < amount) return false;
        p.stats[statName] += amount;
        p.statPoints -= amount;
        this.recalcDerived();
        return true;
    }

    deallocateStat(statName, amount = 1) {
        const p = this.player;
        if (!SAO_STATS.includes(statName) || p.stats[statName] <= 1) return false;
        p.stats[statName] -= amount;
        p.statPoints += amount;
        this.recalcDerived();
        return true;
    }

    // ── NPC ──
    addBot(id, name, nickname, dept) {
        const key = this._sanitizeId(id);
        if (!this.bots[key]) {
            this.bots[key] = { id: key, affection: 0, annoyance: 0, stage: 0 };
        }
        Object.assign(this.bots[key], {
            name: name || key,
            nickname: nickname || name || key,
            dept: dept || 'Encountered',
        });
        this.bots[key].stage = this._calcStage(this.bots[key].affection, this.bots[key].annoyance);
        return this.bots[key];
    }

    getBot = (id) => this.bots[this._sanitizeId(id)] || null;

    removeBot(id) {
        delete this.bots[this._sanitizeId(id)];
    }

    updateRelationship(id, affDelta, annDelta = 0) {
        const key = this._sanitizeId(id);
        const bot = this.bots[key] ?? this.addBot(id, id, id);
        bot.affection = Math.max(0, Math.min(100, bot.affection + affDelta));
        bot.annoyance = Math.max(0, Math.min(100, bot.annoyance + annDelta));
        bot.stage = this._calcStage(bot.affection, bot.annoyance);
        return bot;
    }

    setRelationship(id, aff, ann) {
        const key = this._sanitizeId(id);
        const bot = this.bots[key] ?? this.addBot(id, id, id);
        bot.affection = Math.max(0, Math.min(100, aff));
        bot.annoyance = Math.max(0, Math.min(100, ann));
        bot.stage = this._calcStage(bot.affection, bot.annoyance);
        return bot;
    }

    // ── Inventory ──
    addItem(name, qty = 1) {
        if (!name?.trim()) return;
        const trimmed = name.trim();
        const existing = this.inventory.find(i => i.name.toLowerCase() === trimmed.toLowerCase());
        if (existing) existing.qty += qty;
        else this.inventory.push({ name: trimmed, qty });
    }

    removeItem(name, qty = 1) {
        if (!name?.trim()) return false;
        const idx = this.inventory.findIndex(i => i.name.toLowerCase() === name.trim().toLowerCase());
        if (idx === -1) return false;
        this.inventory[idx].qty -= qty;
        if (this.inventory[idx].qty <= 0) this.inventory.splice(idx, 1);
        return true;
    }

    // ── Persistence ──
    save() {
        if (this._isLoading) return;
        try {
            const ctx = getContext();
            if (!ctx.chatMetadata) return;
            ctx.chatMetadata[META_KEY] = {
                bots:      structuredClone(this.bots),
                inventory: structuredClone(this.inventory),
                player:    structuredClone(this.player),
            };
            saveMetadataDebounced();
            console.debug(LOG_PREFIX, 'Data saved');
        } catch (err) {
            console.error(LOG_PREFIX, 'Save error:', err);
        }
    }

    load() {
        this._isLoading = true;
        try {
            const data = getContext().chatMetadata?.[META_KEY];
            this.bots      = data?.bots      ? structuredClone(data.bots)      : {};
            this.inventory = data?.inventory ? structuredClone(data.inventory) : [];
            this.player    = data?.player    ? structuredClone(data.player)    : this._defaultPlayer();
            // Ensure all SAO stats exist (migration safety)
            for (const s of SAO_STATS) {
                if (this.player.stats[s] === undefined) this.player.stats[s] = 1;
            }
            this.recalcDerived();
            console.debug(LOG_PREFIX, `Loaded: ${Object.keys(this.bots).length} NPCs, Lv.${this.player.level}`);
        } catch (err) {
            console.error(LOG_PREFIX, 'Load error:', err);
            this.bots = {}; this.inventory = []; this.player = this._defaultPlayer();
        } finally {
            this._isLoading = false;
        }
    }

    reset() {
        this.bots = {}; this.inventory = []; this.player = this._defaultPlayer();
    }

    // ── Helpers ──
    _sanitizeId = (id) => String(id).trim().toLowerCase().replace(/\s+/g, '_');

    _calcStage(aff, ann) {
        let s = 0;
        if      (aff >= 90) s = 6;
        else if (aff >= 75) s = 5;
        else if (aff >= 60) s = 4;
        else if (aff >= 40) s = 3;
        else if (aff >= 20) s = 2;
        else if (aff >= 10) s = 1;
        if (ann >= 80 && s > 4) s = 4;
        return s;
    }
}

// ═══════════════════════════════════════════
//  UI RENDERER – สร้างและอัพเดท UI ทั้งหมด
// ═══════════════════════════════════════════
class UIRenderer {
    constructor(data) {
        /** @type {DataEngine} */
        this.data = data;
        this.activeTab = 'all';
        this.selectedNpc = null;  // NPC detail sub-view inside RELATIONSHIP
    }

    // ── Escape helpers ──
    static esc(text) {
        const d = document.createElement('div');
        d.textContent = String(text ?? '');
        return d.innerHTML;
    }
    static escAttr(text) {
        return String(text ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Stage & Insight ──
    static STAGE_NAMES = ['Stranger', 'Acquaintance', 'Noticed', 'Interest', 'Tension', 'Attached', 'Devoted'];

    static getInsight(aff, ann) {
        if (ann >= 90) return 'ระคายเคืองสุดๆ';
        if (ann >= 80) return 'โกรธทุกครั้งที่เจอ';
        if (ann >= 70) return 'อยากเดินหนีทุกที';
        if (ann >= 60) return 'ทนได้ยากมาก';
        if (ann >= 50) return 'เริ่มหลีกเลี่ยง';
        if (aff >= 90) return 'ไม่อยากให้ใครแย่งไป';
        if (aff >= 80) return 'ยอมรับกับตัวเองแล้ว';
        if (aff >= 70) return 'อยากคุยด้วยทุกวัน';
        if (aff >= 60) return 'คิดถึงตอนไม่ได้เจอ';
        if (aff >= 50) return 'จับตามองโดยไม่รู้ตัว';
        if (aff >= 40) return 'ชอบอยู่ใกล้มากขึ้น';
        if (aff >= 30) return 'มีความรู้สึกแปลกๆ';
        if (aff >= 20) return 'รู้สึกว่ามีตัวตน';
        if (aff >= 10) return 'เริ่มจดจำหน้าได้';
        return 'ยังไม่สนใจพิเศษ';
    }

    static renderPips(stage) {
        return Array.from({ length: 7 }, (_, i) =>
            `<div class="ac-pip ${stage === 6 ? 'mx' : (i < stage ? 'f' : '')}"></div>`
        ).join('');
    }

    // ── Main render ──
    render() {
        const tabs = document.getElementById('ac-tabs');
        const panels = document.getElementById('ac-panels');
        if (!tabs || !panels) return;

        const npcKeys = Object.keys(this.data.bots);
        this._renderTabs(tabs, npcKeys);
        this._renderPanels(panels, npcKeys);
    }

    _renderTabs(el, npcKeys) {
        const t = (tab) => this.activeTab === tab ? 'active' : '';
        let h = `<button class="ac-tab ${t('all')}" data-tab="all">✦ RELATIONSHIP</button>`;
        h += `<button class="ac-tab ${t('status')}" data-tab="status">⚔ STATUS</button>`;
        h += `<button class="ac-tab ${t('inventory')}" data-tab="inventory">📦 INVENTORY</button>`;
        el.innerHTML = h;
        el.querySelectorAll('.ac-tab').forEach(btn =>
            btn.addEventListener('click', (e) => { this.activeTab = e.currentTarget.dataset.tab; this.selectedNpc = null; this.render(); })
        );
    }

    _renderPanels(el, npcKeys) {
        const { esc, escAttr, STAGE_NAMES, getInsight, renderPips } = UIRenderer;
        let h = '';

        // ── RELATIONSHIP panel (grid + detail sub-view) ──
        h += `<div class="ac-panel ${this.activeTab === 'all' ? 'active' : ''}">`;

        if (this.selectedNpc && this.data.bots[this.selectedNpc]) {
            // ── Detail sub-view for selected NPC ──
            const id = this.selectedNpc;
            const b = this.data.bots[id];
            h += `<button class="ac-back-btn" id="ac-back-to-grid">← BACK</button>
                <div class="ac-detail">
                    <div class="ac-detail-head">
                        <span class="ac-detail-name">${esc(b.name)}</span>
                        <span class="ac-detail-nick">&ldquo;${esc(b.nickname)}&rdquo;</span>
                        <div class="ac-detail-dept">${esc(b.dept)}</div>
                    </div>
                    <div class="ac-stats3">
                        <div class="ac-stat-box lk"><span class="ac-stat-val lk">${b.affection}</span><span class="ac-stat-label">AFFECTION</span></div>
                        <div class="ac-stat-box an"><span class="ac-stat-val an">${b.annoyance}</span><span class="ac-stat-label">ANNOYANCE</span></div>
                        <div class="ac-stat-box st"><span class="ac-stat-val st">${STAGE_NAMES[b.stage] ?? 'Unknown'}</span><span class="ac-stat-label">STAGE</span></div>
                    </div>
                    <div class="ac-pips-wrap"><div class="ac-pips-head"><span>ROUTE PROGRESS</span><span>${b.stage} / 6</span></div><div class="ac-pips">${renderPips(b.stage)}</div></div>
                    <div class="ac-quote">${getInsight(b.affection, b.annoyance)}</div>
                    <div class="ac-detail-actions">
                        <button class="ac-btn ac-btn-edit" data-npc-id="${escAttr(id)}">✎ EDIT</button>
                        <button class="ac-btn ac-btn-remove" data-npc-id="${escAttr(id)}">✕ REMOVE</button>
                    </div>
                </div>`;
        } else {
            // ── Grid overview ──
            if (npcKeys.length === 0) {
                h += `<div class="ac-empty-state"><div class="ac-empty-icon">✦</div><div class="ac-empty-title">NO ENTITIES DETECTED</div><div class="ac-empty-desc">Send messages or use /npc-add to register NPCs</div></div>`;
            } else {
                h += '<div class="ac-grid">';
                for (const id of npcKeys) {
                    const b = this.data.bots[id];
                    h += `<div class="ac-card" data-target="${escAttr(id)}">
                        <div class="ac-card-name">${esc(b.nickname)}</div>
                        <div class="ac-card-dept">${esc(b.dept)}</div>
                        <div class="ac-card-divider"><span>❧ STATUS ❧</span></div>
                        <div class="ac-gauge"><span class="ac-gauge-label">AFFECTION</span><div class="ac-gauge-track"><div class="ac-gauge-fill lk" style="width:${b.affection}%"></div></div><span class="ac-gauge-val lk">${b.affection}</span></div>
                        <div class="ac-gauge"><span class="ac-gauge-label">ANNOYANCE</span><div class="ac-gauge-track"><div class="ac-gauge-fill an" style="width:${b.annoyance}%"></div></div><span class="ac-gauge-val an">${b.annoyance}</span></div>
                    </div>`;
                }
                h += '</div>';
            }
        }
        h += '</div>';

        // ── Player STATUS panel (SAO Style) ──
        h += `<div class="ac-panel ${this.activeTab === 'status' ? 'active' : ''}">`;
        const p = this.data.player;
        const hpPct = p.hpMax > 0 ? Math.min(100, (p.hp / p.hpMax) * 100) : 0;
        const mpPct = p.mpMax > 0 ? Math.min(100, (p.mp / p.mpMax) * 100) : 0;
        const expPct = p.expMax > 0 ? Math.min(100, (p.exp / p.expMax) * 100) : 0;

        h += `<div class="sao-status">
            <div class="sao-level-badge">Lv. ${p.level}</div>
            <div class="sao-bars">
                <div class="sao-bar-row"><span class="sao-bar-label hp-label">HP</span><div class="sao-bar"><div class="sao-bar-fill sao-hp" style="width:${hpPct}%"></div></div><span class="sao-bar-val">${p.hp} / ${p.hpMax}</span></div>
                <div class="sao-bar-row"><span class="sao-bar-label mp-label">MP</span><div class="sao-bar"><div class="sao-bar-fill sao-mp" style="width:${mpPct}%"></div></div><span class="sao-bar-val">${p.mp} / ${p.mpMax}</span></div>
                <div class="sao-bar-row"><span class="sao-bar-label exp-label">EXP</span><div class="sao-bar"><div class="sao-bar-fill sao-exp" style="width:${expPct}%"></div></div><span class="sao-bar-val">${p.exp} / ${p.expMax}</span></div>
            </div>
            ${p.statPoints > 0 ? `<div class="sao-points-banner">⚡ STAT POINTS AVAILABLE: <b>${p.statPoints}</b></div>` : ''}
            <div class="sao-stats-grid">`;
        for (const stat of SAO_STATS) {
            const val = p.stats[stat];
            h += `<div class="sao-stat-row">
                <span class="sao-stat-name">${stat}</span>
                <span class="sao-stat-value">${val}</span>
                <div class="sao-stat-btns">
                    <button class="sao-stat-btn sao-minus" data-stat="${stat}" ${val <= 1 ? 'disabled' : ''}>−</button>
                    <button class="sao-stat-btn sao-plus" data-stat="${stat}" ${p.statPoints <= 0 ? 'disabled' : ''}>+</button>
                </div>
            </div>`;
        }
        h += `</div></div></div>`;

        // ── Inventory panel ──
        h += `<div class="ac-panel ${this.activeTab === 'inventory' ? 'active' : ''}">`;
        if (this.data.inventory.length === 0) {
            h += `<div class="ac-inv-empty">No items in inventory.<br><i style="font-size:.65rem;color:var(--tx3)">Use /inventory-add [item] to add items</i></div>`;
        } else {
            h += '<ul class="ac-inv-list">';
            for (const item of this.data.inventory) {
                h += `<li class="ac-inv-item"><span class="ac-inv-item-name">${esc(item.name)}</span><span class="ac-inv-item-qty">×${item.qty}</span></li>`;
            }
            h += '</ul>';
        }
        h += '</div>';

        el.innerHTML = h;
        this._bindPanelEvents(el);
    }

    _bindPanelEvents(el) {
        // Card click → show NPC detail sub-view
        el.querySelectorAll('.ac-card').forEach(c =>
            c.addEventListener('click', (e) => { this.selectedNpc = e.currentTarget.dataset.target; this.render(); })
        );
        // Back button → return to grid
        document.getElementById('ac-back-to-grid')?.addEventListener('click', () => { this.selectedNpc = null; this.render(); });
        // Edit/Remove NPC
        el.querySelectorAll('.ac-btn-edit').forEach(b =>
            b.addEventListener('click', (e) => { e.stopPropagation(); controller.openNpcEditor(e.currentTarget.dataset.npcId); })
        );
        el.querySelectorAll('.ac-btn-remove').forEach(b =>
            b.addEventListener('click', (e) => { e.stopPropagation(); controller.confirmRemoveNpc(e.currentTarget.dataset.npcId); })
        );
        // SAO stat +/- buttons
        el.querySelectorAll('.sao-plus').forEach(b =>
            b.addEventListener('click', (e) => { controller.data.allocateStat(e.currentTarget.dataset.stat); controller.saveAndRender(); })
        );
        el.querySelectorAll('.sao-minus').forEach(b =>
            b.addEventListener('click', (e) => { controller.data.deallocateStat(e.currentTarget.dataset.stat); controller.saveAndRender(); })
        );
    }
}

// ═══════════════════════════════════════════
//  CONTROLLER – ควบคุมการทำงานทั้งหมด
// ═══════════════════════════════════════════
class AzureCodexController {
    constructor() {
        this.data = new DataEngine();
        this.ui = new UIRenderer(this.data);
        this.detector = new StatDetector();
        this._initialized = false;
    }

    // ── Core actions ──
    saveAndRender() {
        this.data.save();
        this.ui.render();
    }

    // ── NPC Detection ──
    static COMMON_WORDS = new Set([
        'the', 'and', 'but', 'for', 'not', 'you', 'all', 'can', 'had', 'her',
        'was', 'one', 'our', 'out', 'are', 'has', 'his', 'how', 'its', 'may',
        'new', 'now', 'old', 'see', 'way', 'who', 'did', 'get', 'let', 'say',
        'she', 'too', 'use', 'him', 'than', 'then', 'them', 'been', 'have',
        'said', 'each', 'will', 'they', 'this', 'that', 'with', 'what', 'your',
        'from', 'just', 'very', 'some', 'more', 'also', 'into', 'note', 'action',
        'system', 'user', 'info', 'error', 'warning', 'true', 'false',
    ]);

    detectNPCsFromMessage(text) {
        if (!extension_settings[META_KEY]?.autoDetect || !text || this.data._isLoading) return;

        const boldRx = /\*\*([A-Za-z\u0E00-\u0E7F\u4E00-\u9FFF][A-Za-z\u0E00-\u0E7F\u4E00-\u9FFF\s]{0,25})\*\*/g;
        const detected = new Set();
        let m;
        while ((m = boldRx.exec(text)) !== null) {
            const name = m[1].trim();
            if (name.length >= 2 && !AzureCodexController.COMMON_WORDS.has(name.toLowerCase())) {
                detected.add(name);
            }
        }

        const newNames = [];
        for (const name of detected) {
            const key = this.data._sanitizeId(name);
            if (!this.data.bots[key]) {
                this.data.bots[key] = { id: key, name, nickname: name, dept: 'Encountered', affection: 0, annoyance: 0, stage: 0 };
                newNames.push(name);
                console.debug(LOG_PREFIX, 'Auto-detected NPC:', name);
            }
        }

        if (newNames.length > 0) {
            this.saveAndRender();
            toastr?.info?.(`Tracked: ${newNames.join(', ')}`, '✦ New NPC Detected', { timeOut: 4000 });
        }
    }

    // ── Player Stats Detection (SAO) ──
    detectPlayerStatsFromMessage(text) {
        if (!extension_settings[META_KEY]?.autoDetectStats || !text || this.data._isLoading) return;

        const detected = this.detector.detect(text);
        const keys = Object.keys(detected);
        if (keys.length === 0) return;

        const p = this.data.player;
        let changed = false;
        const updates = [];

        for (const name of keys) {
            const { value, max } = detected[name];
            const upper = name.toUpperCase();

            // Map detected stats to SAO player fields
            if (upper === 'HP' || upper === 'พลังชีวิต' || upper === 'HEALTH') {
                if (p.hp !== value) { p.hp = value; changed = true; updates.push(`HP: ${value}`); }
                if (max != null && p.hpMax !== max) { p.hpMax = max; changed = true; }
            } else if (upper === 'MP' || upper === 'MANA' || upper === 'พลังเวทย์') {
                if (p.mp !== value) { p.mp = value; changed = true; updates.push(`MP: ${value}`); }
                if (max != null && p.mpMax !== max) { p.mpMax = max; changed = true; }
            } else if (upper === 'EXP' || upper === 'XP') {
                if (p.exp !== value) { p.exp = value; changed = true; updates.push(`EXP: ${value}`); }
                if (max != null && p.expMax !== max) { p.expMax = max; changed = true; }
            } else if (upper === 'LV' || upper === 'LEVEL' || upper === 'เลเวล') {
                const newLv = Math.floor(value);
                if (newLv > p.level) {
                    const gained = this.data.levelUp(newLv);
                    changed = true;
                    updates.push(`Level Up! Lv.${newLv} (+${gained} pts)`);
                    toastr?.success?.(`Level ${newLv}! +${gained} stat points!`, '⭐ LEVEL UP!', { timeOut: 5000 });
                } else if (newLv !== p.level) {
                    p.level = newLv; changed = true; updates.push(`Lv.${newLv}`);
                }
            } else if (upper === 'GOLD' || upper === 'MONEY' || upper === 'COIN' || upper === 'ทอง' || upper === 'เงิน') {
                // Gold goes to inventory
                const goldItem = this.data.inventory.find(i => i.name === 'Gold');
                if (goldItem) goldItem.qty = value;
                else this.data.inventory.push({ name: 'Gold', qty: value });
                changed = true; updates.push(`Gold: ${value}`);
            }
        }

        if (changed) {
            this.saveAndRender();
            console.debug(LOG_PREFIX, 'Stats updated:', updates.join(', '));
            if (updates.length > 0) toastr?.info?.(updates.join(', '), '⚔ Status Updated', { timeOut: 3000 });
        }
    }

    // ── Process a message (detect both NPCs and stats) ──
    processMessage(text) {
        this.detectNPCsFromMessage(text);
        this.detectPlayerStatsFromMessage(text);
    }

    // ── NPC Editor popup ──
    async openNpcEditor(npcId) {
        const bot = this.data.getBot(npcId);
        if (!bot) return;
        const { esc, escAttr } = UIRenderer;

        const html = `<div class="ac-editor">
            <h3 style="margin:0 0 .8rem;font-family:'Cinzel',serif;letter-spacing:.15em;color:#6ab8e8;text-align:center">✎ EDIT — ${esc(bot.nickname)}</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:.8rem">
                <div><label style="font-size:.72rem;color:#5a7a92;letter-spacing:.08em;display:block;margin-bottom:.25rem">NICKNAME</label>
                <input id="ac-edit-nickname" type="text" value="${escAttr(bot.nickname)}" style="width:100%;padding:.4rem .5rem;background:#040a14;color:#d0e6f0;border:1px solid #182a3d;font-size:.8rem;box-sizing:border-box"/></div>
                <div><label style="font-size:.72rem;color:#5a7a92;letter-spacing:.08em;display:block;margin-bottom:.25rem">DEPT / ROLE</label>
                <input id="ac-edit-dept" type="text" value="${escAttr(bot.dept)}" style="width:100%;padding:.4rem .5rem;background:#040a14;color:#d0e6f0;border:1px solid #182a3d;font-size:.8rem;box-sizing:border-box"/></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:.6rem">
                <div><label style="font-size:.72rem;color:#5a7a92;letter-spacing:.08em;display:block;margin-bottom:.25rem">AFFECTION (0-100)</label>
                <input id="ac-edit-affection" type="range" min="0" max="100" value="${bot.affection}" style="width:100%;accent-color:#1e90ff"/>
                <div style="text-align:center;font-size:.85rem;color:#33ccff" id="ac-edit-aff-val">${bot.affection}</div></div>
                <div><label style="font-size:.72rem;color:#5a7a92;letter-spacing:.08em;display:block;margin-bottom:.25rem">ANNOYANCE (0-100)</label>
                <input id="ac-edit-annoyance" type="range" min="0" max="100" value="${bot.annoyance}" style="width:100%;accent-color:#6ab8e8"/>
                <div style="text-align:center;font-size:.85rem;color:#8ce0ff" id="ac-edit-ann-val">${bot.annoyance}</div></div>
            </div>
        </div>`;

        // Bind sliders live before await
        setTimeout(() => {
            document.getElementById('ac-edit-affection')?.addEventListener('input', e => {
                const v = document.getElementById('ac-edit-aff-val'); if (v) v.textContent = e.target.value;
            });
            document.getElementById('ac-edit-annoyance')?.addEventListener('input', e => {
                const v = document.getElementById('ac-edit-ann-val'); if (v) v.textContent = e.target.value;
            });
        }, 100);

        const ok = await callGenericPopup(html, POPUP_TYPE.CONFIRM);
        if (!ok) return;

        bot.nickname = document.getElementById('ac-edit-nickname')?.value?.trim() || bot.nickname;
        bot.dept = document.getElementById('ac-edit-dept')?.value?.trim() || bot.dept;
        this.data.setRelationship(npcId,
            parseInt(document.getElementById('ac-edit-affection')?.value) || 0,
            parseInt(document.getElementById('ac-edit-annoyance')?.value) || 0,
        );
        this.saveAndRender();
        toastr?.info?.(`${bot.nickname} updated`, '✦ NPC Edited');
    }

    async confirmRemoveNpc(npcId) {
        const bot = this.data.getBot(npcId);
        const name = bot ? bot.nickname : npcId;
        const ok = await callGenericPopup(`<h3>Remove NPC</h3><p>Remove <b>${UIRenderer.esc(name)}</b> from tracker?</p>`, POPUP_TYPE.CONFIRM);
        if (ok) {
            this.ui.selectedNpc = null;
            this.data.removeBot(npcId);
            this.saveAndRender();
        }
    }

    // ── Reset all data ──
    async confirmReset() {
        const ok = await callGenericPopup(
            '<h3>⟳ Reset Azure Codex?</h3><p>Delete <b>all NPC, stats, and inventory data</b> for this chat?</p><p style="color:#e74c3c;font-size:.85rem">⚠ Cannot be undone.</p>',
            POPUP_TYPE.CONFIRM,
        );
        if (ok) {
            this.data.reset();
            this.ui.activeTab = 'all';
            this.saveAndRender();
            toastr?.success?.('All data cleared.', '✦ Azure Codex – Reset Complete');
        }
    }

    // ── Create Overlay UI ──
    createOverlay() {
        document.getElementById('azure-codex-root')?.remove();
        document.getElementById('azure-codex-float-btn')?.remove();

        const btn = document.createElement('button');
        btn.id = 'azure-codex-float-btn';
        btn.textContent = '✦ Azure Codex';
        document.body.appendChild(btn);

        const root = document.createElement('div');
        root.id = 'azure-codex-root';
        root.innerHTML = `
        <div class="ac-wrapper">
            <div class="ac-header">
                <div class="ac-header-left">
                    <div class="ac-title">Azure Codex</div>
                    <div class="ac-subtitle">NPC & Player Tracker · System Active</div>
                </div>
                <div class="ac-header-right">
                    <div class="ac-heartbeat">
                        <svg width="120" height="20" viewBox="0 0 120 20">
                            <polyline points="0,10 10,10 15,3 20,17 25,10 30,10 35,10 38,5 41,15 44,10 54,10 59,3 64,17 69,10 79,10 84,5 87,15 90,10 100,10 105,3 110,17 115,10 120,10" fill="none" stroke="#003366" stroke-width="1.2"/>
                            <polyline points="0,10 10,10 15,3 20,17 25,10 30,10 35,10 38,5 41,15 44,10 54,10 59,3 64,17 69,10 79,10 84,5 87,15 90,10 100,10 105,3 110,17 115,10 120,10" fill="none" stroke="#1e90ff" stroke-width="0.6" opacity="0.5"/>
                        </svg>
                    </div>
                    <button class="ac-close-btn" id="ac-close-btn">CLOSE</button>
                </div>
            </div>
            <div class="ac-body">
                <div class="ac-tabs" id="ac-tabs"></div>
                <div id="ac-panels"></div>
            </div>
            <div class="ac-footer">
                <span class="ac-footer-text">Omnia in numeris</span>
                <button class="ac-btn ac-btn-reset" id="ac-reset-btn">⟳ RESET ALL</button>
                <span class="ac-footer-text">✦ Azure Codex · SYSTEM ✦</span>
            </div>
            <div class="ac-bg-deco">❄️</div>
            <span class="ac-ornament tl">✦</span>
            <span class="ac-ornament tr">✦</span>
            <span class="ac-ornament bl">✦</span>
            <span class="ac-ornament br">✦</span>
        </div>`;
        document.body.appendChild(root);

        btn.addEventListener('click', () => root.classList.toggle('show-overlay'));
        document.getElementById('ac-close-btn').addEventListener('click', () => root.classList.remove('show-overlay'));
        document.getElementById('ac-reset-btn').addEventListener('click', () => this.confirmReset());

        this.updateFloatBtn();
        this.ui.render();
    }

    toggleOverlay() {
        document.getElementById('azure-codex-root')?.classList.toggle('show-overlay');
    }

    updateFloatBtn() {
        const btn = document.getElementById('azure-codex-float-btn');
        if (btn) btn.style.display = extension_settings[META_KEY]?.showFloatBtn !== false ? '' : 'none';
    }

    // ── Settings ──
    loadSettings() {
        if (!extension_settings[META_KEY]) {
            extension_settings[META_KEY] = { ...DEFAULT_SETTINGS };
        }
        for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
            if (extension_settings[META_KEY][k] === undefined) {
                extension_settings[META_KEY][k] = v;
            }
        }
        $('#azure_codex_auto_detect').prop('checked', extension_settings[META_KEY].autoDetect);
        $('#azure_codex_auto_detect_stats').prop('checked', extension_settings[META_KEY].autoDetectStats);
        $('#azure_codex_show_float_btn').prop('checked', extension_settings[META_KEY].showFloatBtn);
    }

    onSettingsChange() {
        extension_settings[META_KEY].autoDetect = $('#azure_codex_auto_detect').is(':checked');
        extension_settings[META_KEY].autoDetectStats = $('#azure_codex_auto_detect_stats').is(':checked');
        extension_settings[META_KEY].showFloatBtn = $('#azure_codex_show_float_btn').is(':checked');
        saveSettingsDebounced();
        controller.updateFloatBtn();
    }

    // ── Slash Commands ──
    registerCommands() {
        const cmd = (name, cb, args, help) => SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name, callback: cb, helpString: help, returns: 'confirmation message',
            unnamedArgumentList: args ? [SlashCommandArgument.fromProps({ description: args, typeList: [ARGUMENT_TYPE.STRING], isRequired: true })] : [],
        }));

        cmd('codex',      async () => { this.toggleOverlay(); return 'Azure Codex toggled.'; },
            null, 'Toggle the Azure Codex panel.');

        cmd('npc-add',    async (_, v) => { const n = v?.trim(); if (!n) return 'Usage: /npc-add [name]'; this.data.addBot(n, n, n); this.saveAndRender(); return `NPC "${n}" added.`; },
            'NPC name', 'Add a new NPC to tracker.');

        cmd('npc-remove', async (_, v) => { const n = v?.trim(); if (!n) return 'Usage: /npc-remove [name]'; this.data.removeBot(n); this.saveAndRender(); return `NPC "${n}" removed.`; },
            'NPC name', 'Remove an NPC from tracker.');

        cmd('rel',        async (_, v) => {
            const p = v?.trim().split(/\s+/); if (!p || p.length < 2) return 'Usage: /rel [name] [affection_delta] [annoyance_delta?]';
            this.data.updateRelationship(p[0], parseInt(p[1]) || 0, parseInt(p[2]) || 0); this.saveAndRender();
            return `Relationship updated for "${p[0]}".`;
        }, 'name affDelta [annDelta]', 'Update NPC relationship values.');

        cmd('inventory-add', async (_, v) => { const n = v?.trim(); if (!n) return 'Usage: /inventory-add [item]'; this.data.addItem(n); this.saveAndRender(); return `Added "${n}" to inventory.`; },
            'Item name', 'Add an item to inventory.');

        cmd('inventory-remove', async (_, v) => { const n = v?.trim(); if (!n) return 'Usage: /inventory-remove [item]'; const ok = this.data.removeItem(n); this.saveAndRender(); return ok ? `Removed "${n}".` : `"${n}" not found.`; },
            'Item name', 'Remove an item from inventory.');

        cmd('stat-alloc', async (_, v) => {
            const p = v?.trim().split(/\s+/); if (!p || p.length < 1) return 'Usage: /stat-alloc [STR|AGI|VIT|INT|DEX|LUK] [amount?]';
            const stat = p[0].toUpperCase(); const amt = parseInt(p[1]) || 1;
            if (!SAO_STATS.includes(stat)) return `Invalid stat. Use: ${SAO_STATS.join(', ')}`;
            const ok = this.data.allocateStat(stat, amt); this.saveAndRender();
            return ok ? `Allocated ${amt} point(s) to ${stat}.` : 'Not enough stat points!';
        }, 'stat [amount]', 'Allocate stat points. Example: /stat-alloc STR 3');

        cmd('levelup', async (_, v) => {
            const newLv = parseInt(v?.trim()) || (this.data.player.level + 1);
            const gained = this.data.levelUp(newLv); this.saveAndRender();
            return gained > 0 ? `Level Up! Lv.${newLv} (+${gained} stat points)` : `Level set to ${newLv}.`;
        }, '[level]', 'Level up. Usage: /levelup or /levelup 10');

        cmd('codex-reset', async () => { await this.confirmReset(); return 'Reset complete.'; },
            null, 'Reset all Azure Codex data for this chat.');

        console.debug(LOG_PREFIX, 'Commands registered');
    }

    // ── Event Hooks ──
    setupEvents() {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.debug(LOG_PREFIX, 'Chat changed, loading...');
            this.data.load();
            this.ui.activeTab = 'all';
            this.ui.render();

            // Scan existing messages
            setTimeout(() => {
                try {
                    const chat = getContext().chat;
                    if (!Array.isArray(chat)) return;
                    for (const msg of chat) {
                        if (!msg.is_user && !msg.is_system && msg.mes) {
                            this.processMessage(msg.mes);
                        }
                    }
                } catch (err) {
                    console.warn(LOG_PREFIX, 'Error scanning chat:', err);
                }
            }, 500);
        });

        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (idx) => {
            try {
                const msg = getContext().chat?.[idx];
                if (!msg || msg.is_user || msg.is_system) return;
                this.processMessage(msg.mes);
            } catch (err) {
                console.warn(LOG_PREFIX, 'Error processing message:', err);
            }
        });

        console.debug(LOG_PREFIX, 'Events set up');
    }

    // ── Init ──
    async init() {
        // Settings template
        try {
            const settingsHtml = await renderExtensionTemplateAsync(EXT_NAME, 'settings');
            $('#extensions_settings2').append(settingsHtml);
        } catch {
            const fallbackHtml = `
            <div id="azure-codex-settings"><div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header"><b>Azure Codex – NPC & Player Tracker</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
                <div class="inline-drawer-content"><div class="flex-container flexFlowColumn">
                    <label class="checkbox_label" for="azure_codex_auto_detect"><input id="azure_codex_auto_detect" type="checkbox" checked/><span>Auto-detect NPCs from messages</span></label>
                    <label class="checkbox_label" for="azure_codex_auto_detect_stats"><input id="azure_codex_auto_detect_stats" type="checkbox" checked/><span>Auto-detect player stats from messages</span></label>
                    <label class="checkbox_label" for="azure_codex_show_float_btn"><input id="azure_codex_show_float_btn" type="checkbox" checked/><span>Show floating button</span></label>
                    <hr/><div class="flex-container"><button id="azure_codex_open_panel" class="menu_button"><i class="fa-solid fa-compass"></i><span>Open Azure Codex</span></button></div>
                </div></div>
            </div></div>`;
            $('#extensions_settings2').append(fallbackHtml);
        }

        this.loadSettings();
        $('#azure_codex_auto_detect, #azure_codex_auto_detect_stats, #azure_codex_show_float_btn').on('change', () => this.onSettingsChange());
        $('#azure_codex_open_panel').on('click', () => this.toggleOverlay());

        // Wand menu button
        $('#extensionsMenu').append(`<div id="azure_codex_wand_btn" class="list-group-item flex-container flexGap5"><div class="fa-solid fa-compass extensionsMenuExtensionButton"></div>Azure Codex</div>`);
        $('#azure_codex_wand_btn').on('click', () => this.toggleOverlay());

        this.createOverlay();
        this.registerCommands();
        this.setupEvents();

        // Load current chat
        try {
            if (getContext().chatMetadata) {
                this.data.load();
                this.ui.render();
            }
        } catch { /* no active chat */ }

        this._initialized = true;
        console.log(LOG_PREFIX, 'Azure Codex extension loaded successfully! ✦');
    }
}

// ═══════════════════════════════════════════
//  BOOTSTRAP
// ═══════════════════════════════════════════
const controller = new AzureCodexController();
jQuery(() => controller.init());
