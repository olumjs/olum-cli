#!/usr/bin/env node
/**
 * @name olum-cli
 * @copyright 2021
 * @author Eissa Saber
 * @license MIT
 */

// check node version
const requiredNodeMajorVer = +require("../package.json").engines.node.replace(/\<|\>|\=/gi,"").split(".")[0];
const currentNodeMajorVer = +process.version.replace(/v/gi, "").split(".")[0];
if (currentNodeMajorVer < requiredNodeMajorVer) {
  console.error(`\nYour node version is "${currentNodeMajorVer}" which is not compatible with 'olum-cli', Please upgrade to "${requiredNodeMajorVer}" or higher\n`);
  process.exit(1);
}

const commander = require("commander");
const cmd = new commander.Command();
const inquirer = require("inquirer");
const download = require("download-git-repo");
const fs = require("fs");
const path = require("path");
const colors = require("colors");
const { exec } = require("child_process");
const pkgJSON = require("../package.json");

// helpers
const isObj = obj => !!(obj !== null && typeof obj === "object");
const isFullObj = obj => !!(isObj(obj) && Array.isArray(Object.keys(obj)) && Object.keys(obj).length);
const isFullArr = arr => !!(isObj(arr) && Array.isArray(arr) && arr.length);
const isDef = val => !!(val !== undefined && val !== null);
String.prototype.cap = function () {
  return this.toLowerCase().split(" ").map(function (word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
};

class CLI {
  hasHelpers = false;
  constructor() {
    cmd.version(pkgJSON.version);
    cmd.on("command:*", operands => {
      console.error(colors.red(`error: unknown command '${operands[0]}'\n Try running olum --help`));
      process.exitCode = 1;
    });
    cmd.on("--help", this.guide.bind(this));
    cmd.command("create").arguments("<name>").action(this.create.bind(this));
    // cmd.command("generate").option("-c, --component <file>").option("-s, --service <file>").action(this.generate.bind(this));
    cmd.command("g").option("-c, --component <file>").option("-s, --service <file>").action(this.generate.bind(this));
    cmd.parse(process.argv);
  }
  
  generate(obj) {
    let type;
    let filePath;
    if (isFullObj(obj)) {
      if (obj.hasOwnProperty("component")) type = "component";
      else if (obj.hasOwnProperty("service")) type = "service";
      filePath = obj[type];
      let absolutePath = path.resolve(process.cwd(), filePath);
      const basename = path.basename(absolutePath);
      const dir = absolutePath.replace(new RegExp(basename+"$"), ""); // remove last portion
      // console.log({ type, filePath, absolutePath, basename, dir });
      
      // create directory if it doesn't exist
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // get file name 
      const fileName = basename.replace(/(\.[a-z]+)$/i, ""); // remove extensions if any
      // console.log({ fileName });
      
      let data;
      if (type === "component") {
        data = this.component(fileName);
        absolutePath = absolutePath.replace(new RegExp(basename+"$"), fileName.cap() + ".html");
      } else if (type === "service") {
        data = this.service(fileName);
        absolutePath = absolutePath.replace(new RegExp(basename+"$"), fileName.toLowerCase() + ".js");
      } 
      // console.log({ finalPath: absolutePath });

      // create files
      fs.writeFile(absolutePath, data, err => {
        if (err) return console.error(colors.red.bold(err));
      });

    }
  }
  
  component(name) {
    let data = 
`<template>
  <div id="{{id}}"></div>
</template>

<script>
  export default class {{name}} {
    render() {}
  }
</script>

<style lang="scss">
  #{{id}} {
  }
</style>`;

    data = data.replace(/\{\{name\}\}/g, name.cap());
    data = data.replace(/\{\{id\}\}/g, name.toLowerCase());
    return data;
  }
  
  service(name) {
    let data = 
`import { Service } from "olum-helpers";

class {{name}} extends Service {
  constructor() {
    super("{{event}}");
  }
}

const {{export}} = new {{name}}();
export default {{export}};`;

    data = data.replace(/\{\{name\}\}/g, name.cap());
    data = data.replace(/\{\{event\}\}/g, "olum_" + name.toLowerCase() + "_event");
    data = data.replace(/\{\{export\}\}/g, name.toLowerCase());
    return data;
  }

  random(arr) {
    if (isFullArr(arr)) return Math.floor(Math.random() * arr.length);
  }

  guide() {
    const { version, description } = pkgJSON;
    const shorthand = pkgJSON.olum;
    const titleArr = shorthand.colors.title;
    const accent = titleArr[this.random(titleArr)];

    const hl  = s => colors[accent].bold(s);
    const cmd = s => colors.cyan.bold(s);
    const arg = s => colors.cyan(s);
    const dim = s => colors.dim(s);
    const rule = dim("  " + "─".repeat(54));

    const row = (usage, explanation, note = "") =>
      "    " + arg(usage.padEnd(28)) + dim(explanation) + (note ? "  " + dim(note) : "");

    const out = `
${hl(shorthand.signature[0])}
  ${colors.bold("olum-cli")}  ${dim("v" + version)}  ${dim("·")}  ${dim(description)}

${rule}

  ${hl("Usage")}

    ${cmd("olum")} ${arg("<command>")} ${dim("[options]")}

  ${hl("Commands")}

${row("create <name>",         "Scaffold a new olum project in the current directory")}

  ${hl("Options")}

${row("-V, --version",         "Output the version number")}
${row("-h, --help",            "Display this help message")}

  ${hl("Docs")}

    ${colors.cyan(shorthand.docs.url)}

${rule}
`;

    console.clear();
    console.log(out);
  }

  clone(name, branch) {
    this.loader("Generating boilerplate");
    const repo = "https://github.com/olumjs/olum-starter.git";
    return new Promise((resolve, reject) => {
      download(`direct:${repo}#${branch}`, `./${name}`, { clone: true }, err => {
        if (err) return reject("Error while cloning starter code \n" + err);
        
        if (this.hasHelpers) {
          fs.readFile(`./${name}/package.json`, "utf8", (err, data) => {
            if (err) return reject(err);
            const content = JSON.parse(data);
            content.dependencies["olum-helpers"] = "latest";
            fs.writeFile(`./${name}/package.json`, JSON.stringify(content, null, 2), err => {
              if (err) return reject(err);
              return resolve();
            });
          });
        }
        
        return resolve();
      });
    });
  }

  git(name) {
    this.loader("Initializing git repository");
    return new Promise((resolve, reject) => {
      exec(`cd ${name} && git init && git add . && git commit -m "Initial Commit via Olum CLI"`, (error, stdout, stderr) => {
        if (error) return reject(error);
        console.log(stdout);
        console.log(stderr);
        resolve();
      });
    });
  }

  dep(name) {
    this.loader("Installing packages");
    return new Promise((resolve, reject) => {
      exec(`cd ${name} && npm i`, (error, stdout, stderr) => {
        if (error) return reject(error);
        console.log(stdout);
        console.log(stderr);
        resolve();
      });
    });
  }

  postInstall(name) {
    const cd = colors.cyan("cd "+name);
    const dev = colors.cyan("npm run dev");
    const build = colors.cyan("npm run build\n");
    const border = "────────────────";
    const title = colors.green.bold("Happy Coding!");
    const info = 
    `
    ${colors.green.bold(border)}
    
      ${title}  

      - Navigate to project:    ${cd}
      - Run Development Server: ${dev}
      - Build for Production:   ${build}
    ${colors.green.bold(border)}
    `;
    this.stopLoader();
    console.clear();
    console.log(info);

    // check latest version of olum-cli
    exec('npm show olum-cli version', (error, stdout, stderr) => {
      if (error || stderr) return;
      const current = require("../package.json").version;
      const latest = stdout.trim();
      const currentVerArr = current.split(".");
      const latestVerArr = latest.split(".");
      
      if (isFullArr(currentVerArr) && isFullArr(latestVerArr) ) {
        let type;
        // current 
        const currentMajor = +currentVerArr[0];
        const currentMinor = +currentVerArr[1];
        const currentRevision = +currentVerArr[2];
        // latest
        const latestMajor = +latestVerArr[0];
        const latestMinor = +latestVerArr[1];
        const latestRevision = +latestVerArr[2];
        
        // console.log({currentMajor, currentMinor, currentRevision});
        // console.log({latestMajor, latestMinor, latestRevision});
        
        if (currentMajor < latestMajor) type = "major";
        else if (currentMinor < latestMinor) type = "minor";
        else if (currentRevision < latestRevision) type = "revision";
        
        const hint = 
        `
    ${colors.yellow.bold(border)}
    
      ${`New ${colors.red(type)} version of olum-cli available! ${colors.red(current)} > ${colors.green(latest)}`}
      
      ${`Run ${colors.green("npm install -g olum-cli")} to update!`}
      
    ${colors.yellow.bold(border)}
        `;
        
        if (typeof type != "undefined") console.log(hint);

      }
      
    });

  }

  loader(msg) {
    if (typeof this.interval != "undefined") {
      clearInterval(this.interval);
      process.stdout.write("\r" + colors.green("✔") + " " + colors.bold(this.currentMsg) + "\x1B[K\n");
    } else {
      process.stdout.write("\x1B[?25l"); // hide cursor
    }
    this.currentMsg = msg;
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let x = 0;
    this.interval = setInterval(() => {
      process.stdout.write("\r" + colors.cyan(frames[x]) + " " + colors.bold(msg) + "\x1B[K");
      x = (x + 1) % frames.length;
    }, 80);
  }

  stopLoader() {
    if (typeof this.interval != "undefined") clearInterval(this.interval);
    process.stdout.write("\x1B[?25h"); // restore cursor
  }
  
  gitignore(name) {
    return new Promise((resolve, reject) => {
      const content = 
`# Olum files/dirs
package-lock.json
build
desktop
nwjs

# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*
.pnpm-debug.log*

# Diagnostic reports (https://nodejs.org/api/report.html)
report.[0-9]*.[0-9]*.[0-9]*.[0-9]*.json

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Directory for instrumented libs generated by jscoverage/JSCover
lib-cov

# Coverage directory used by tools like istanbul
coverage
*.lcov

# nyc test coverage
.nyc_output

# Grunt intermediate storage (https://gruntjs.com/creating-plugins#storing-task-files)
.grunt

# Bower dependency directory (https://bower.io/)
bower_components

# node-waf configuration
.lock-wscript

# Compiled binary addons (https://nodejs.org/api/addons.html)
build/Release

# Dependency directories
node_modules/
jspm_packages/

# Snowpack dependency directory (https://snowpack.dev/)
web_modules/

# TypeScript cache
*.tsbuildinfo

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Microbundle cache
.rpt2_cache/
.rts2_cache_cjs/
.rts2_cache_es/
.rts2_cache_umd/

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env
.env.test
.env.production

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# Next.js build output
.next
out

# Nuxt.js build / generate output
.nuxt
dist

# Gatsby files
.cache/
# Comment in the public line in if your project uses Gatsby and not Next.js
# https://nextjs.org/blog/next-9-1#public-directory-support
# public

# vuepress build output
.vuepress/dist

# Serverless directories
.serverless/

# FuseBox cache
.fusebox/

# DynamoDB Local files
.dynamodb/

# TernJS port file
.tern-port

# Stores VSCode versions used for testing VSCode extensions
.vscode-test
.vscode

# yarn v2
.yarn/cache
.yarn/unplugged
.yarn/build-state.yml
.yarn/install-state.gz
.pnp.*

# macOS
.DS_Store`;

      fs.writeFile(`./${name}/.gitignore`, content, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  
  readme(name) {
    return new Promise((resolve, reject) => {
      const content = 
`# ${name}

## Installation
\`\`\`
npm install
\`\`\`

### Development server
\`\`\`
npm run dev
\`\`\`

### Build for production
\`\`\`
npm run build
\`\`\`

See [Documentation](https://olumjs.github.io/docs)`;

      fs.writeFile(`./${name}/README.md`, content, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  
  async create(name) {
    try {
      // generate boilerplate
      await this.clone(name, "core");
      await this.readme(name);
      await this.gitignore(name);
      
      // installing modules
      await this.dep(name);
      
      // init git repo
      await this.git(name);
      
      // instructions
      this.postInstall(name);
    } catch (err) {
      this.stopLoader();
      console.error(colors.red(err));
    }
  }
}

new CLI();