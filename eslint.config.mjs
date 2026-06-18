import obsidianmd from "eslint-plugin-obsidianmd";

export default [
    {
        ignores: [
            "main.js",
            "node_modules/",
            "*.config.mjs",
            "PDF Extract Test Vault/",
        ],
    },
    ...obsidianmd.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.json",
            },
        },
    },
    {
        files: ["package.json"],
        rules: {
            "obsidianmd/no-plugin-as-component": "off",
        },
    },
];
