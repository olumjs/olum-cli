#!/usr/bin/env node
/**
 * @name olum-cli
 * @copyright 2026
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
const download = require("download-git-repo");
const fs = require("fs");
const path = require("path");
const https = require("https");
const colors = require("colors");
const { exec } = require("child_process");
const pkgJSON = require("../package.json");

// olum-ui registry
const uiRawUrl = "https://raw.githubusercontent.com/olumjs/olum-ui/refs/heads/main";
const registryUrl = `${uiRawUrl}/registry.json`;

// helpers
const isObj = obj => !!(obj !== null && typeof obj === "object");
const isFullObj = obj => !!(isObj(obj) && Array.isArray(Object.keys(obj)) && Object.keys(obj).length);
const isFullArr = arr => !!(isObj(arr) && Array.isArray(arr) && arr.length);
const isDef = val => !!(val !== undefined && val !== null);
const toKebabCase = str => str
  .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
  .replace(/[\s_]+/g, "-")
  .replace(/[^a-zA-Z0-9-]/g, "")
  .toLowerCase();
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
    cmd.command("create").arguments("<name>").option("--tailwind", "Install Tailwind CSS").action(this.create.bind(this));
    cmd.command("add").arguments("<name>").action(this.add.bind(this));
    cmd.parse(process.argv);
  }

  tailwind(name) {
    this.loader("Configuring Tailwind CSS");
    return new Promise((resolve, reject) => {
      const pkgPath = `./${name}/package.json`;
      fs.readFile(pkgPath, "utf8", (err, data) => {
        if (err) return reject(err);
        const content = JSON.parse(data);

        content.scripts = content.scripts || {};
        Object.assign(content.scripts, {
          css: "tailwindcss -i src/main.css -o public/main.css",
          "css:watch": "npm run css -- --watch",
          "dev:app": "olum-compiler dev",
          dev: "npm run css && concurrently -k -n css,app -c magenta,green \"npm run css:watch\" \"npm run dev:app\"",
        });

        content.devDependencies = content.devDependencies || {};
        Object.assign(content.devDependencies, {
          "@tailwindcss/cli": "latest",
          tailwindcss: "latest",
          concurrently: "latest",
        });

        fs.writeFile(pkgPath, JSON.stringify(content, null, 2), err => {
          if (err) return reject(err);

          fs.readFile(`./${name}/public/main.css`, "utf8", (err, css) => {
            if (err) return reject(err);

            fs.writeFile(`./${name}/src/main.css`, `@import "tailwindcss";\n\n${css}`, err => {
              if (err) return reject(err);

              const tailwindConfig =
`/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.html", "./src/**/*.js"],
  theme: {
    extend: {},
  },
  plugins: [],
}
`;
              fs.writeFile(`./${name}/tailwind.config.js`, tailwindConfig, err => {
                if (err) return reject(err);
                resolve();
              });
            });
          });
        });
      });
    });
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
${row("add <name>",            "Add an olum-ui component to src/components/ui")}

  ${hl("Flags")}

${row("--tailwind",             "Install and configure Tailwind CSS")}

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
        
        fs.readFile(`./${name}/package.json`, "utf8", (err, data) => {
          if (err) return reject(err);
          const content = JSON.parse(data);
          content.name = toKebabCase(name);
          if (this.hasHelpers) content.dependencies["olum-helpers"] = "latest";
          fs.writeFile(`./${name}/package.json`, JSON.stringify(content, null, 2), err => {
            if (err) return reject(err);
            return resolve();
          });
        });
      });
    });
  }

  readme(name) {
    return new Promise((resolve, reject) => {
      const readmePath = `./${name}/README.md`;
      fs.readFile(readmePath, "utf8", (err, data) => {
        if (err) return reject(err);
        fs.writeFile(readmePath, data.replace(/{{name}}/g, name), err => {
          if (err) return reject(err);
          resolve();
        });
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
  
  async create(name, options) {
    try {
      // generate boilerplate
      await this.clone(name, "main");

      // rename app in README
      await this.readme(name);

      // options
      if (options.tailwind) await this.tailwind(name);

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

  fetch(url) {
    return new Promise((resolve, reject) => {
      https
        .get(url, { headers: { "User-Agent": "olum-cli" } }, res => {
          const { statusCode, headers } = res;

          // follow redirects
          if (statusCode >= 300 && statusCode < 400 && isDef(headers.location)) {
            res.resume();
            return resolve(this.fetch(headers.location));
          }

          if (statusCode !== 200) {
            res.resume();
            return reject(`Request failed with status code ${statusCode}\n${url}`);
          }

          let data = "";
          res.setEncoding("utf8");
          res.on("data", chunk => (data += chunk));
          res.on("end", () => resolve(data));
        })
        .on("error", err => reject(err));
    });
  }

  registry() {
    this.loader("Fetching registry");
    return this.fetch(registryUrl).then(raw => {
      let content;
      try {
        content = JSON.parse(raw);
      } catch (err) {
        return Promise.reject("Error while parsing registry.json \n" + err);
      }
      if (!isFullObj(content) || !isFullArr(content.components)) return Promise.reject("No components found in the registry");
      return content.components;
    });
  }

  component(name, components) {
    const slug = toKebabCase(name);
    const found = components.find(item => isFullObj(item) && toKebabCase(item.name) === slug);
    if (!isDef(found)) {
      const available = components.map(item => item.name).join(", ");
      return Promise.reject(`Component '${name}' was not found in the registry\n Available components: ${available}`);
    }
    return Promise.resolve(found);
  }

  ui(component) {
    this.loader(`Adding ${component.title || component.name}`);
    const dir = path.join("src", "components", "ui");
    const dest = path.join(dir, `${toKebabCase(component.name)}.html`);

    return new Promise((resolve, reject) => {
      if (fs.existsSync(dest)) return reject(`'${dest}' already exists, remove it first then run the command again`);

      this.fetch(`${uiRawUrl}/${component.path}`)
        .then(content => {
          fs.mkdir(dir, { recursive: true }, err => {
            if (err) return reject(err);
            fs.writeFile(dest, content, err => {
              if (err) return reject(err);
              resolve(dest);
            });
          });
        })
        .catch(reject);
    });
  }

  async add(name) {
    try {
      // must run from the root of an olum app
      if (!fs.existsSync("package.json")) throw "No 'package.json' found, run this command from the root of your olum app";

      // fetch registry then match the given name against it
      const components = await this.registry();
      const component = await this.component(name, components);

      // clone the component into src/components/ui/<name>.html
      const dest = await this.ui(component);

      this.stopLoader();
      process.stdout.write("\r" + colors.green("✔") + " " + colors.bold(this.currentMsg) + "\x1B[K\n");
      console.log(`\n  Added ${colors.cyan(dest)}\n`);
    } catch (err) {
      this.stopLoader();
      console.error(colors.red(err));
    }
  }
}

new CLI();