export default function getEnv(varName: string, otherwise: any = undefined): string {
    if (process.env[varName]) {
        return process.env[varName];
    } else if (otherwise !== undefined) {
        return otherwise;
    } else {
        throw new Error(`${varName} not set in environment`);
    }
}