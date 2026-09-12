import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const dbName = process.env.D1_DATABASE_NAME || 'moepush-db';
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const projectName = process.env.PROJECT_NAME || 'moepush';

const setupWranglerConfig = () => {
    const wranglerExamplePath = path.resolve('wrangler.example.json');
    const wranglerConfigPath = path.resolve('wrangler.json');

    const wranglerConfig = fs.readFileSync(wranglerExamplePath, 'utf-8');
    const json = JSON.parse(wranglerConfig);
    json.d1_databases[0].database_name = dbName;
    json.name = projectName;
    fs.writeFileSync(wranglerConfigPath, JSON.stringify(json, null, 2));
};

const checkAndCreateDatabase = () => {
    let dbId;

    const getDatabaseId = () => {
        const dbList = execSync('wrangler d1 list --json').toString();
        const databases = JSON.parse(dbList);
        return databases.find((db: any) => db.name === dbName)?.uuid;
    }

    try {
        dbId = getDatabaseId();
    } catch (error) {
        console.error('Error listing databases:', error);
    }

    if (!dbId) {
        console.log(`Creating new D1 database: ${dbName}`);
        execSync(`wrangler d1 create "${dbName}"`);
        dbId = getDatabaseId();
        if (!dbId) {
            throw new Error('Failed to create database');
        }
    } else {
        console.log(`Database ${dbName} already exists`);
    }

    const wranglerConfigPath = path.resolve('wrangler.json');
    const wranglerConfig = JSON.parse(fs.readFileSync(wranglerConfigPath, 'utf-8'));
    wranglerConfig.d1_databases[0].database_id = dbId;
    fs.writeFileSync(wranglerConfigPath, JSON.stringify(wranglerConfig, null, 2));
};

const applyMigrations = () => {
    execSync(`wrangler d1 migrations apply "${dbName}" --remote`);
};

const createPagesSecret = () => {
    const envFilePath = path.resolve('.env');
    const envVariables = [
        `AUTH_SECRET=${process.env.AUTH_SECRET}`,
        `AUTH_GITHUB_ID=${process.env.AUTH_GITHUB_ID}`,
        `AUTH_GITHUB_SECRET=${process.env.AUTH_GITHUB_SECRET}`,
        `DISABLE_REGISTER=${process.env.DISABLE_REGISTER}`,
    ];
    fs.writeFileSync(envFilePath, envVariables.join('\n'));
    execSync(`wrangler pages secret bulk .env`);
};

const deployPages = () => {
    console.log('Deploying to Cloudflare Pages...');
    execSync('pnpm run deploy');
    console.log('Deployment completed successfully');
};

// 使用官方 wrangler CLI 创建 Pages 项目（请求构造正确、报错清晰），并对"已存在"做幂等容错。
const ensurePagesProject = () => {
    console.log(`Ensuring Cloudflare Pages project "${projectName}" exists...`);
    try {
        execSync(`wrangler pages project create "${projectName}" --production-branch main`, { stdio: 'inherit' });
        console.log(`Pages project "${projectName}" is ready.`);
    } catch (error: any) {
        const output = String(error?.stderr ?? error?.stdout ?? error?.message ?? error);
        if (/already exists/i.test(output)) {
            console.log(`Pages project "${projectName}" already exists, continuing.`);
            return;
        }
        console.error('Failed to create Cloudflare Pages project. Raw output:\n', output);
        throw new Error(
            `Failed to create Cloudflare Pages project "${projectName}". ` +
            `请检查：1) CLOUDFLARE_API_TOKEN 是否具备 "Cloudflare Pages: Edit" 权限；` +
            `2) 项目名是否唯一（${projectName}.pages.dev 未被占用）；` +
            `3) PROJECT_NAME 是否合法（仅小写字母/数字/连字符）。`
        );
    }
};

const main = async () => {
    try {
        if (!cloudflareApiToken || !accountId) {
            throw new Error('缺少必需的环境变量：CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID');
        }
        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(projectName)) {
            throw new Error(`PROJECT_NAME "${projectName}" 非法，必须匹配 ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`);
        }

        setupWranglerConfig();
        ensurePagesProject();
        checkAndCreateDatabase();
        applyMigrations();
        createPagesSecret();
        deployPages();

        console.log('🎉 All deployment steps completed successfully!');
    } catch (error) {
        console.error('❌ Deployment failed:', error);
        process.exit(1);
    }
};

main();