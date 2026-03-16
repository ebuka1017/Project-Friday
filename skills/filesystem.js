// skills/filesystem.js — Atomic File System Skills
const fsTools = require('../electron/fs-tools');

module.exports = {
    list_directory: {
        definition: {
            name: "list_directory",
            description: "List the contents of a local directory.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string" }
                },
                required: ["path"]
            }
        },
        execute: async (args) => {
            return await fsTools.listDirectory(args.path);
        }
    },

    read_file: {
        definition: {
            name: "read_file",
            description: "Read the content of a local text file.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string" }
                },
                required: ["path"]
            }
        },
        execute: async (args) => {
            return await fsTools.readFileStr(args.path);
        }
    },

    write_file: {
        definition: {
            name: "write_file",
            description: "Write content to a local file. Overwrites if exists.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string" },
                    content: { type: "string" }
                },
                required: ["path", "content"]
            }
        },
        execute: async (args) => {
            return await fsTools.writeFileStr(args.path, args.content);
        }
    }
};
