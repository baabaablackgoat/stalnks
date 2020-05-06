module.exports = {
    root: true,
    parser: "@typescript-eslint/parser",
    parserOptions: {
        tsconfigRootDir: __dirname,
        project: ["./tsconfig.json"],
    },
    env: {
        "es6": true,
        "node": true,
    },
    plugins: ["@typescript-eslint"],
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:@typescript-eslint/recommended-requiring-type-checking",
    ],
    rules: {
        "no-shadow": "warn",
        "no-undef-init": "warn",
        "array-callback-return": "warn",
        "consistent-return": "warn",
        "no-implicit-coercion": "warn",

        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-floating-promises": "warn",
        "@typescript-eslint/no-throw-literal": "warn",
        "@typescript-eslint/no-base-to-string": "warn",
        "@typescript-eslint/prefer-readonly": "warn",
        "@typescript-eslint/explicit-function-return-type": [
            "warn",
            {
                allowExpressions: true

            }],
    },
};
