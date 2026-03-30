import { extension_settings, getContext } from "../../../extensions.js";
import { registerSlashCommand } from "../../../slash-commands.js";

const extensionName = "st-azure-codex";
const extensionFolderPath = `scripts/extensions/${extensionName}`;

const defaultSettings = {
    bots: {} // { "characterId": { id, name, nickname, affection, annoyance, stage, portraitUrl, dept } }
};

class RelationshipSystem {
    constructor() {
        this.bots = extension_settings[extensionName].bots;
        this.activeTab = 'all'; 
        this.isClosed = true; // Hidden on boot
    }

    initUI() {
        const root = document.getElementById('app-root');
        const floatBtn = document.getElementById('floating-btn');
        const toggleBtn = document.getElementById('toggle-btn');

        floatBtn.addEventListener('click', () => {
            // Auto fetch current bot data before opening
            this.syncCurrentCharacter();
            this.render();
            root.classList.toggle('show-overlay');
        });

        toggleBtn.addEventListener('click', () => {
            root.classList.remove('show-overlay');
        });

        this.render();
    }

    save() {
        // Save to extension_settings and persist to disk via saveSettings
        extension_settings[extensionName].bots = this.bots;
        // Depending on SillyTavern version, getContext() usually exposes saveSettings
        if (typeof getContext().saveSettings === "function") {
            getContext().saveSettings();
        } else if (typeof window.saveSettingsDebounced === "function") {
            window.saveSettingsDebounced();
        }
    }

    syncCurrentCharacter() {
        const context = getContext();
        if (context.characterId === undefined) return;

        const charData = context.characters[context.characterId];
        if (!charData) return;
        
        const botId = charData.name; // In SillyTavern, using name or avatar string is an easiest unique key
        let avatarUrl = 'img/ai.png'; // default fallback in ST
        if (charData.avatar) {
            avatarUrl = `/characters/${charData.avatar}`;
        }

        if (!this.bots[botId]) {
             this.bots[botId] = { 
                 id: botId, affection: 0, annoyance: 0, stage: 0,
                 name: charData.name,
                 nickname: charData.name,
                 dept: "Active Character",
                 portraitUrl: avatarUrl
             };
        } else {
             // Just update portrait dynamically in case it changed
             this.bots[botId].portraitUrl = avatarUrl;
        }
    }

    getBot(botId) {
        if (!this.bots[botId]) {
            this.bots[botId] = {
                 id: botId, affection: 0, annoyance: 0, stage: 0,
                 name: botId, nickname: botId, dept: "Unknown",
                 portraitUrl: "https://via.placeholder.com/150"
            };
        }
        return this.bots[botId];
    }

    calculateStage(affection, annoyance) {
        let stage = 0;
        if (affection >= 90) stage = 6;
        else if (affection >= 75) stage = 5;
        else if (affection >= 60) stage = 4;
        else if (affection >= 40) stage = 3;
        else if (affection >= 20) stage = 2;
        else if (affection >= 10) stage = 1;

        if (annoyance >= 80 && stage > 4) {
             stage = 4; 
        }
        return stage;
    }

    updateRelationship(botId, affectionChange, annoyanceChange = 0) {
        const bot = this.getBot(botId);
        bot.affection = Math.max(0, Math.min(100, bot.affection + affectionChange));
        bot.annoyance = Math.max(0, Math.min(100, bot.annoyance + annoyanceChange));
        bot.stage = this.calculateStage(bot.affection, bot.annoyance);
        
        this.save();
        this.render(); 
        return bot;
    }

    /* -------------------------------------
       DYNAMIC HTML RENDER ENGINE
    -------------------------------------- */
    getStageName(stage) {
        const names = ['Stranger', 'Acquaintance', 'Noticed', 'Interest', 'Tension', 'Attached', 'Devoted'];
        return names[stage] || 'Unknown';
    }

    getInsightQuote(affection, annoyance) {
        if (annoyance >= 90) return 'ระคายเคืองสุดๆ';
        if (annoyance >= 80) return 'โกรธทุกครั้งที่เจอ';
        if (annoyance >= 70) return 'อยากเดินหนีทุกที';
        if (annoyance >= 60) return 'ทนได้ยากมาก';
        if (annoyance >= 50) return 'เริ่มหลีกเลี่ยง';
        
        if (affection >= 90) return 'ไม่อยากให้ใครแย่งไป';
        if (affection >= 80) return 'ยอมรับกับตัวเองแล้ว';
        if (affection >= 70) return 'อยากคุยด้วยทุกวัน';
        if (affection >= 60) return 'คิดถึงตอนไม่ได้เจอ';
        if (affection >= 50) return 'จับตามองโดยไม่รู้ตัว';
        if (affection >= 40) return 'ชอบอยู่ใกล้มากขึ้น';
        if (affection >= 30) return 'มีความรู้สึกแปลกๆ';
        if (affection >= 20) return 'รู้สึกว่ามีตัวตน';
        if (affection >= 10) return 'เริ่มจดจำหน้าได้';
        return 'ยังไม่สนใจพิเศษ';
    }

    renderPips(stage) {
        let html = '';
        for(let i=0; i<7; i++) {
            if(stage === 6) {
               html += `<div class="gpip mx"></div>`;
            } else {
               html += `<div class="gpip ${i < stage ? 'f' : ''}"></div>`;
            }
        }
        return html;
    }

    renderTabs(keys) {
        const container = document.getElementById('ui-tabs');
        if(!container) return;
        
        let html = `<div class="grtab ${this.activeTab === 'all' ? 'active' : ''}" data-tab="all">✦ ALL</div>`;
        keys.forEach(id => {
            const b = this.bots[id];
            html += `<div class="grtab ${this.activeTab === id ? 'active' : ''}" data-tab="${id}">${b.nickname}</div>`;
        });
        container.innerHTML = html;

        container.querySelectorAll('.grtab').forEach(el => {
            el.addEventListener('click', (e) => {
                this.activeTab = e.currentTarget.dataset.tab;
                this.render(); 
            });
        });
    }

    renderPanels(keys) {
        const container = document.getElementById('ui-panels');
        if(!container) return;
        let html = '';

        html += `<div class="grp ${this.activeTab === 'all' ? 'active' : ''}"><div class="grov">`;
        keys.forEach(id => {
            const bot = this.bots[id];
            html += `
                <div class="grc card-switch-tab" data-target="${id}">
                    <img class="grc-img" src="${bot.portraitUrl}" alt="">
                    <div class="grc-name">${bot.nickname}</div>
                    <div class="grc-dept">${bot.dept}</div>
                    <div class="grc-div"><span>❧ STATUS ❧</span></div>
                    <div class="gg"><span class="gg-lbl">AFFECTION</span><div class="gg-track"><div class="gg-fill lk" style="width:${bot.affection}%"></div></div><span class="gg-val lk">${bot.affection}</span></div>
                    <div class="gg"><span class="gg-lbl">ANNOYANCE</span><div class="gg-track"><div class="gg-fill an" style="width:${bot.annoyance}%"></div></div><span class="gg-val an">${bot.annoyance}</span></div>
                </div>
            `;
        });
        html += `</div></div>`;

        keys.forEach(id => {
            const bot = this.bots[id];
            html += `
                <div class="grp ${this.activeTab === id ? 'active' : ''}">
                    <div class="grd">
                        <div class="grd-flex">
                            <img class="grd-portrait" src="${bot.portraitUrl}" alt="${bot.name}">
                            <div class="grd-flex-r">
                                <div class="grd-head">
                                    <span class="grd-name">${bot.name}</span>
                                    <span class="grd-nick">&ldquo;${bot.nickname}&rdquo;</span>
                                    <div class="grd-dept">${bot.dept}</div>
                                </div>
                            </div>
                        </div>
                        <div class="gs3">
                            <div class="gs3-box lk"><span class="gs3-val lk">${bot.affection}</span><span class="gs3-lbl">AFFECTION</span></div>
                            <div class="gs3-box an"><span class="gs3-val an">${bot.annoyance}</span><span class="gs3-lbl">ANNOYANCE</span></div>
                            <div class="gs3-box st"><span class="gs3-val st">${this.getStageName(bot.stage)}</span><span class="gs3-lbl">STAGE</span></div>
                        </div>
                        <div class="gpips-wrap">
                            <div class="gpips-head"><span>ROUTE PROGRESS</span><span>${bot.stage} / 6</span></div>
                            <div class="gpips">${this.renderPips(bot.stage)}</div>
                        </div>
                        <div class="giq">${this.getInsightQuote(bot.affection, bot.annoyance)}</div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        if (this.activeTab === 'all') {
             container.querySelectorAll('.card-switch-tab').forEach(el => {
                 el.addEventListener('click', (e) => {
                        this.activeTab = e.currentTarget.dataset.target;
                        this.render();
                 });
             });
        }
    }

    render() {
        const keys = Object.keys(this.bots);
        this.renderTabs(keys);
        this.renderPanels(keys);
    }
}

// Global scope initialization wrapper
jQuery(async () => {
    // 1. Load settings robustly
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = defaultSettings;
    }

    // 2. Load UI HTML
    try {
        const response = await fetch(`${extensionFolderPath}/template.html`);
        const html = await response.text();
        $("body").append(html);
    } catch(err) {
        console.error("Azure Codex failed to load template", err);
    }

    // 3. Load CSS
    $("head").append(\`<link rel="stylesheet" href="\${extensionFolderPath}/style.css">\`);

    // 4. Initialize logic
    const codex = new RelationshipSystem();
    codex.initUI();
    
    // 5. Register Slash Commands for interacting inside chat
    registerSlashCommand("codex-aff", (args) => {
        const amount = parseInt(args);
        if(isNaN(amount)) return "";
        const ctx = getContext();
        if(ctx.characterId === undefined) return "No active character to add affection.";
        const cname = ctx.characters[ctx.characterId].name;
        
        codex.syncCurrentCharacter();
        codex.updateRelationship(cname, amount, 0);
        return `CodeX: Added ${amount} Affection to ${cname}!`;
    }, {
        help: "Add affection to current active character.",
        unnamedArgumentList: [{ type: "number", description: "Amount (e.g. 10 or -5)" }]
    });

    registerSlashCommand("codex-ann", (args) => {
        const amount = parseInt(args);
        if(isNaN(amount)) return "";
        const ctx = getContext();
        if(ctx.characterId === undefined) return "No active character to add annoyance.";
        const cname = ctx.characters[ctx.characterId].name;
        
        codex.syncCurrentCharacter();
        codex.updateRelationship(cname, 0, amount);
        return `CodeX: Added ${amount} Annoyance to ${cname}!`;
    }, {
        help: "Add annoyance to current active character.",
        unnamedArgumentList: [{ type: "number", description: "Amount (e.g. 5 or -10)" }]
    });
});
