const fs = require('fs');
const path = require('path');
const toolsRegistry = require('../shared/tools-registry');

class SkillManager {
    constructor() {
        this.skills = new Map();
        this.skillsPath = path.join(process.cwd(), 'skills');
    }

    /**
     * Load all skills from the skills/ directory and the static registry.
     */
    async loadAll() {
        // 1. Load static tools from registry
        const staticTools = toolsRegistry.getAllTools();
        for (const tool of staticTools) {
            this.skills.set(tool.name, {
                definition: tool,
                isStatic: true
            });
        }

        // 2. Load dynamic skills from skills/ folder
        if (fs.existsSync(this.skillsPath)) {
            const files = fs.readdirSync(this.skillsPath);
            for (const file of files) {
                if (file.endsWith('.js')) {
                    try {
                        const skillModule = require(path.join(this.skillsPath, file));
                        for (const [name, skill] of Object.entries(skillModule)) {
                            // Dynamic skills override static definitions if names clash
                            this.skills.set(name, skill);
                        }
                    } catch (e) {
                        console.error(`[SkillManager] Failed to load skill file ${file}:`, e.message);
                    }
                }
            }
        }
        
        console.log(`[SkillManager] Total tools available: ${this.skills.size}`);
    }
    
    getDefinitions() {
        return Array.from(this.skills.values())
            .map(s => s.definition || (s.getDefinition ? s.getDefinition() : null))
            .filter(d => d !== null);
    }

    async execute(name, args, context) {
        const skill = this.skills.get(name);
        if (!skill) throw new Error(`Skill not found: ${name}`);
        
        // 1. Handle Dynamic/Local Skills
        if (skill.execute) {
            return await skill.execute(args, context);
        }
        
        // Fallback for tools defined only in registry
        throw new Error(`Skill ${name} is static and has no execution logic in SkillManager.`);
    }
}

module.exports = new SkillManager();
