// electron/skill-manager.js — Dynamic Skill Loader
const fs = require('fs');
const path = require('path');

class SkillManager {
    constructor() {
        this.skills = new Map();
        this.skillsPath = path.join(process.cwd(), 'skills');
    }

    /**
     * Load all skills from the skills/ directory.
     */
    async loadAll() {
        if (!fs.existsSync(this.skillsPath)) return;
        
        const files = fs.readdirSync(this.skillsPath);
        for (const file of files) {
            if (file.endsWith('.js')) {
                const skillModule = require(path.join(this.skillsPath, file));
                for (const [name, skill] of Object.entries(skillModule)) {
                    this.skills.set(name, skill);
                }
            }
        }
        console.log(`[SkillManager] Loaded ${this.skills.size} atomic skills.`);
    }

    getDefinitions() {
        return Array.from(this.skills.values()).map(s => s.definition);
    }

    async execute(name, args, context) {
        const skill = this.skills.get(name);
        if (!skill) throw new Error(`Skill not found: ${name}`);
        return await skill.execute(args, context);
    }
}

module.exports = new SkillManager();
