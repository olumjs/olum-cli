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
const http = require("http");
const { homedir } = require("os");
const colors = require("colors");
const { exec } = require("child_process");
const pkgJSON = require("../package.json");

// olum-ui registry
const uiRawUrl = "https://raw.githubusercontent.com/olumjs/olum-ui/refs/heads/main";
const registryUrl = `${uiRawUrl}/registry.json`;
// the tokens themselves, not the docs site's src/main.css that wraps them in @font-face rules
const stylesPath = "src/components/ui/olum-ui.css";
// where the registry keeps its components, deps are resolved against it
const uiRoot = "src/components/ui";
// where they land in the app, mirroring the library's folder structure so the relative imports keep working
const uiDest = path.join("src", "components", "ui");
// the app gets its own copy, kept out of src/main.css so it survives a tailwind rebuild
const stylesDest = path.join(uiDest, "olum-ui.css");
// the same path as an url, for the <link> the app has to add
const stylesHref = "/" + stylesDest.split(path.sep).join("/");
// components meant for the library's own docs, never installable
const uiInternal = "internal";
// import specifiers, both the static and the dynamic form
const importPaths = /(?:^|[\s;}])(?:import|export)[^"';]*?from\s*["']([^"']+)["']|(?:^|[\s;}])import\s*\(?\s*["']([^"']+)["']/g;

// anonymous usage ping, sent once a command has finished. Overridable so the endpoint
// can be pointed at a local dev server while it's being worked on
// the canonical host: the apex domain 308-redirects to www, and this request doesn't
// follow redirects, so posting to the apex silently drops every ping
const telemetryUrl = process.env.OLUM_TELEMETRY_URL || "https://www.olumjs.top/api/telemetry";
// only the two platforms node names differently from how anyone reads them. Everything
// else (freebsd, openbsd, sunos, aix, android...) is reported under its own name
const telemetryPlatforms = { darwin: "macos", win32: "windows" };
// a ping is never worth making anyone wait for
const telemetryTimeout = 3000;
// drop this file in your home directory to stop a machine reporting at all
const telemetryOptOutFile = ".olum-no-telemetry";

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
        fs.writeFile(readmePath, data.replace(/{name}/g, name), err => {
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

  // a spec npm can't re-resolve to a newer release: a local path, a git or http url, an
  // alias. Those are deliberate, they're installed exactly as the starter wrote them
  fixed(range) {
    const spec = String(range || "");
    return spec.includes(":") || spec.startsWith(".") || spec.startsWith("/");
  }

  // A plain `npm i` reinstalls whatever the starter's package.json describes, and a range
  // written months ago resolves to what it resolved to back then. Install the two fields
  // by name instead — `pkg@latest` re-resolves the dist-tag on every run — and let npm
  // write the version it actually picked back into package.json as a caret range. That is
  // what the pinning step used to do by hand, only now it's npm's own answer, and the
  // lockfile npm writes alongside it — the starter commits it — holds the tree still.
  dep(name) {
    this.loader("Installing packages");
    const pkgPath = path.join(`./${name}`, "package.json");
    return new Promise((resolve, reject) => {
      fs.readFile(pkgPath, "utf8", (err, data) => {
        if (err) return reject(err);

        let content;
        try {
          content = JSON.parse(data);
        } catch (err) {
          return reject("Error while parsing 'package.json' \n" + err);
        }

        // "pkg@latest" for anything the registry serves, the original spec for the rest
        const specs = field => {
          const deps = content[field];
          if (!isFullObj(deps)) return [];
          return Object.keys(deps).map(pkg => (this.fixed(deps[pkg]) ? `${pkg}@${deps[pkg]}` : `${pkg}@latest`));
        };

        const deps = specs("dependencies");
        const devDeps = specs("devDependencies");

        // npm adds them back as it installs, at the versions it just resolved
        delete content.dependencies;
        delete content.devDependencies;

        const eol = data.endsWith("\n") ? "\n" : "";
        fs.writeFile(pkgPath, JSON.stringify(content, null, 2) + eol, err => {
          if (err) return reject(err);

          const steps = [];
          if (isFullArr(deps)) steps.push(`npm i ${deps.join(" ")}`);
          if (isFullArr(devDeps)) steps.push(`npm i -D ${devDeps.join(" ")}`);
          // an app with no dependencies at all still needs its lockfile
          if (!isFullArr(steps)) steps.push("npm i");

          exec(`cd ${name} && ${steps.join(" && ")}`, (error, stdout, stderr) => {
            if (error) return reject(error);
            console.log(stdout);
            console.log(stderr);
            resolve();
          });
        });
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
  
  // the version a package resolved to in the app. The starter pins "latest", so the
  // range in package.json is only a fallback for when node_modules isn't there to be
  // read. Covers devDependencies too, which is where olum-compiler lives
  depVersion(dir, pkg) {
    const root = isDef(dir) ? dir : ".";
    try {
      const installed = path.join(root, "node_modules", pkg, "package.json");
      if (fs.existsSync(installed)) {
        const content = JSON.parse(fs.readFileSync(installed, "utf8"));
        if (isDef(content.version)) return String(content.version).slice(0, 32);
      }

      const pkgPath = path.join(root, "package.json");
      if (fs.existsSync(pkgPath)) {
        const content = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const deps = Object.assign({}, content.dependencies, content.devDependencies);
        // "^0.9.2" and "~0.9.2" both describe 0.9.2
        if (isDef(deps[pkg])) return String(deps[pkg]).replace(/^[\^~>=<\s]+/, "").slice(0, 32) || "unknown";
      }
    } catch (err) {
      // a missing or malformed package.json says nothing about the CLI run itself
    }
    return "unknown";
  }

  // the flags a command actually ran with, e.g. ["tailwind"]. Commander leaves the
  // ones that weren't passed undefined, so only the truthy keys are real
  flags(options) {
    if (!isFullObj(options)) return [];
    return Object.keys(options).filter(key => options[key] === true);
  }

  // why this run shouldn't report, or null when it should. A reason rather than a
  // boolean so the debug flag can name the check that suppressed the ping. The numbers
  // are only worth anything if they describe real installs, so development, CI and
  // opted-out machines report nothing
  telemetrySkip() {
    // a published install always sits inside a node_modules directory. Running from a
    // git checkout never does, and `npm link` resolves back to the checkout, so both
    // the maintainer's runs and any contributor's are excluded without configuration
    if (__dirname.split(path.sep).indexOf("node_modules") === -1) return "running from a source checkout, not an install";

    // a build matrix across node versions would otherwise outnumber the real users
    const ci = process.env.CI;
    if (isDef(ci) && ci !== "" && ci !== "false" && ci !== "0") return `CI is set (CI=${ci})`;

    // per-machine opt out, the only thing that covers testing a genuine install
    try {
      const marker = path.join(homedir(), telemetryOptOutFile);
      if (fs.existsSync(marker)) return `opted out by ${marker}`;
    } catch (err) {
      // no readable home directory isn't a reason to change the outcome
    }

    return null;
  }

  // OLUM_TELEMETRY_DEBUG=1 makes the ping visible: what would be sent, and what became
  // of it. Silent otherwise, so a normal run never mentions telemetry at all
  telemetryLog(msg) {
    const flag = process.env.OLUM_TELEMETRY_DEBUG;
    if (!isDef(flag) || flag === "" || flag === "0" || flag === "false") return;
    console.log(colors.dim(`[telemetry] ${msg}`));
  }

  // anonymous usage ping: cli version, olum version, node major, os, which command ran,
  // the olum-ui component `add` installed and the flags `create` used. No paths, project
  // names or anything else identifying. Best-effort by definition, so every failure path
  // resolves quietly and a broken endpoint can never change the outcome of a command
  telemetry(dir, type, name, options) {
    return new Promise(resolve => {
      let settled = false;
      // one resolve whichever way this ends: response, error, or timeout
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      try {
        const skip = this.telemetrySkip();
        if (isDef(skip)) {
          this.telemetryLog(`not sent — ${skip}`);
          return finish();
        }

        const platform = String(process.platform || "").toLowerCase();
        const os = telemetryPlatforms[platform] || platform || "unknown";

        const body = JSON.stringify({
          cliVersion: pkgJSON.version,
          olumVersion: this.depVersion(dir, "olum"),
          compilerVersion: this.depVersion(dir, "olum-compiler"),
          // the exact runtime as node reports it, "24.15.0" — sent verbatim, a major
          // alone can't separate a patch-level regression from the whole release line
          nodeVersion: process.versions.node,
          os,
          type,
          // kebab-cased so the same component or project counts as one label however it was typed
          name: isDef(name) ? toKebabCase(String(name)) : undefined,
          options: this.flags(options),
          timestamp: new Date().toISOString(),
        });

        // https everywhere except a local dev endpoint, which node refuses to
        // dial with the https client
        const transport = telemetryUrl.indexOf("http://") === 0 ? http : https;

        const req = transport.request(
          telemetryUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
              "User-Agent": "olum-cli",
            },
            timeout: telemetryTimeout,
          },
          res => {
            // drained so the socket closes; the status is of no use to the user, and
            // only surfaces under the debug flag
            res.resume();
            res.on("end", () => {
              this.telemetryLog(`sent — HTTP ${res.statusCode}`);
              finish();
            });
            res.on("error", err => {
              this.telemetryLog(`response failed — ${err.message}`);
              finish();
            });
          }
        );

        req.on("error", err => {
          this.telemetryLog(`not sent — ${err.message}`);
          finish();
        });
        req.on("timeout", () => {
          this.telemetryLog(`not sent — no response within ${telemetryTimeout}ms`);
          req.destroy();
          finish();
        });

        this.telemetryLog(`POST ${telemetryUrl}`);
        this.telemetryLog(body);
        req.end(body);
      } catch (err) {
        this.telemetryLog(`not sent — ${err.message}`);
        finish();
      }
    });
  }

  async create(name, options) {
    try {
      // generate boilerplate
      await this.clone(name, "main");

      // rename app in README
      await this.readme(name);

      // options
      if (options.tailwind) await this.tailwind(name);

      // installing modules, each one at its latest release
      await this.dep(name);

      // init git repo
      await this.git(name);
      
      // instructions
      this.postInstall(name);

      // reported here rather than in a `finally` so only a project that actually
      // scaffolded is counted — a clone or install that died partway isn't one.
      // Last thing the command does, so a slow network can't hold up any output.
      // The project name is the user's own wording and can identify them or an
      // unreleased product, so only the fact that a project was created is
      // reported, never its name
      await this.telemetry(name, "create", undefined, options);
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
    // raw.githubusercontent caches, and a stale registry points at files the library has already moved
    return this.fetch(`${registryUrl}?t=${Date.now()}`).then(raw => {
      let content;
      try {
        content = JSON.parse(raw);
      } catch (err) {
        return Promise.reject("Error while parsing registry.json \n" + err);
      }
      if (!isFullObj(content) || !isFullArr(content.components)) return Promise.reject("No components found in the registry");
      // the library's own docs components aren't meant to be installed
      return content.components.filter(item => isFullObj(item) && isDef(item.path) && item.category !== uiInternal);
    });
  }

  component(name, components) {
    const slug = toKebabCase(name);
    const found = components.find(item => toKebabCase(item.name) === slug);
    if (!isDef(found)) {
      // group by category, the registry is long enough that a flat list is hard to scan
      const groups = components.reduce((acc, item) => {
        const category = item.category || "other";
        (acc[category] = acc[category] || []).push(item.name);
        return acc;
      }, {});
      const available = Object.keys(groups)
        .map(category => `\n   ${colors.bold(category)}  ${groups[category].join(", ")}`)
        .join("");
      return Promise.reject(`Component '${name}' was not found in the registry\n\n  Available components:${available}`);
    }
    return Promise.resolve(found);
  }

  // mirror the library's layout so the relative imports between components resolve
  dest(item) {
    const rel = item.startsWith(`${uiRoot}/`) ? item.slice(uiRoot.length + 1) : path.posix.basename(item);
    return path.join(uiDest, ...rel.split("/"));
  }

  // a component is its own file plus the deps listed in the registry. A dep with a slash is always
  // relative to the library's src/components ("Button/Button.html"). A bare name is ambiguous: it's
  // either a sibling of the component ("CardTitle.html") or a file shared by several of them, sitting
  // at the root of the components folder ("portal.js"). Both are candidates, the sibling wins.
  files(component) {
    const dir = path.posix.dirname(component.path);
    const deps = isFullArr(component.deps) ? component.deps : [];
    const candidates = [[component.path]].concat(
      deps.map(dep => (dep.includes("/") ? [path.posix.join(uiRoot, dep)] : [path.posix.join(dir, dep), path.posix.join(uiRoot, dep)]))
    );

    return candidates
      .filter((item, i, arr) => arr.findIndex(other => other.join("\n") === item.join("\n")) === i)
      .map(paths => ({ paths, dests: paths.map(item => this.dest(item)) }));
  }

  // the candidates are guesses, keep the first one the library actually has
  async resolve(paths) {
    for (let i = 0; i < paths.length; i++) {
      try {
        return { path: paths[i], source: await this.fetch(`${uiRawUrl}/${paths[i]}`) };
      } catch (err) {
        if (i === paths.length - 1) throw err;
      }
    }
  }

  async ui(component) {
    this.loader(`Adding ${component.title || component.name}`);
    const files = this.files(component);
    const [main] = files;

    // an ambiguous dep may already be installed under either of its candidate paths
    const installed = file => file.dests.filter(dest => fs.existsSync(dest))[0];

    if (isDef(installed(main))) throw `'${main.dests[0]}' already exists, remove it first then run the command again`;

    // deps are shared between components, whatever is already there was installed by an earlier 'add'
    const missing = files.filter(file => !isDef(installed(file)));
    const skipped = files.filter(file => isDef(installed(file))).map(installed);

    const resolved = await Promise.all(missing.map(file => this.resolve(file.paths)));

    const added = [];
    for (let i = 0; i < resolved.length; i++) {
      const dest = this.dest(resolved[i].path);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.writeFile(dest, resolved[i].source);
      added.push(dest);
    }

    // main is files[0] and can't have been skipped, the throw above covers that
    return { dest: added[0], added, skipped, source: resolved.map(item => item.source).join("\n") };
  }

  // olum-ui components rely on the design tokens defined in the library's main.css
  styles() {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync("src")) return reject("No 'src' found, run this command from the root of your olum app");

      // keep any local tweaks, only write it the first time
      if (fs.existsSync(stylesDest)) return resolve(null);

      this.loader("Adding olum-ui styles");
      this.fetch(`${uiRawUrl}/${stylesPath}`)
        .then(content => {
          // the components folder is there by now, unless every file of this component was already installed
          fs.mkdir(path.dirname(stylesDest), { recursive: true }, err => {
            if (err) return reject(err);
            fs.writeFile(stylesDest, content, err => {
              if (err) return reject(err);
              resolve(stylesDest);
            });
          });
        })
        .catch(reject);
    });
  }

  // every bare specifier a component imports is a runtime package, relative ones are the deps we just cloned
  packages(source) {
    const found = [];
    let match;
    importPaths.lastIndex = 0;
    while (isDef((match = importPaths.exec(source)))) {
      const specifier = match[1] || match[2];
      if (!isDef(specifier) || specifier.startsWith(".") || specifier.startsWith("/")) continue;
      // keep the package name, drop any subpath ("pkg/sub", "@scope/pkg/sub")
      const parts = specifier.split("/");
      const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      if (found.indexOf(name) === -1) found.push(name);
    }
    return found;
  }

  // components may import runtime packages, add the missing ones to the app's package.json
  deps(source) {
    const needed = this.packages(source);
    if (!isFullArr(needed)) return Promise.resolve([]);

    return new Promise((resolve, reject) => {
      fs.readFile("package.json", "utf8", (err, data) => {
        if (err) return reject(err);

        let content;
        try {
          content = JSON.parse(data);
        } catch (err) {
          return reject("Error while parsing 'package.json' \n" + err);
        }

        // already there, in any of the dependency fields
        const installed = Object.assign({}, content.dependencies, content.devDependencies, content.peerDependencies);
        const missing = needed.filter(dep => !isDef(installed[dep]));
        if (!isFullArr(missing)) return resolve([]);

        content.dependencies = content.dependencies || {};
        missing.forEach(dep => (content.dependencies[dep] = "latest"));

        // keep the trailing newline if the file had one
        const eol = data.endsWith("\n") ? "\n" : "";
        fs.writeFile("package.json", JSON.stringify(content, null, 2) + eol, err => {
          if (err) return reject(err);
          resolve(missing);
        });
      });
    });
  }

  async add(name) {
    try {
      // must run from the root of an olum app
      if (!fs.existsSync("package.json")) throw "No 'package.json' found, run this command from the root of your olum app";

      // fetch registry then match the given name against it
      const components = await this.registry();
      const component = await this.component(name, components);

      // clone the component and its deps into src/components/ui/<Component>/
      const { dest, added, skipped, source } = await this.ui(component);

      // drop the design tokens next to the components
      const styles = await this.styles();

      // packages the component imports but the app doesn't have
      const packages = await this.deps(source);

      this.stopLoader();
      process.stdout.write("\r" + colors.green("✔") + " " + colors.bold(this.currentMsg) + "\x1B[K\n");
      console.log(`\n  Added ${colors.cyan(dest)}`);
      added.filter(file => file !== dest).forEach(file => console.log(`  Added ${colors.cyan(file)}`));
      skipped.forEach(file => console.log(colors.dim(`  Skipped ${file}, already exists`)));
      if (isDef(styles)) console.log(`  Added ${colors.cyan(styles)}`);
      if (isFullArr(packages)) {
        console.log(`  Added ${colors.cyan(packages.join(", "))} to ${colors.cyan("package.json")}`);
        console.log(colors.yellow(`\n  Run ${colors.cyan("npm i")} to install ${packages.length > 1 ? "them" : "it"}`));
      }
      if (isDef(styles)) {
        console.log(colors.yellow(`\n  Link it in ${colors.cyan("public/index.html")}  ${colors.cyan(`<link rel="stylesheet" href="${stylesHref}" />`)}`));
        // both files define their own tokens, merging them is left to the app
        if (fs.existsSync(path.join("src", "main.css"))) console.log(colors.yellow(`  Styles in ${colors.cyan("src/main.css")} may affect ${colors.cyan("olum-ui.css")}, it's up to you to merge or handle them`));
      }
      console.log("");

      // reported here rather than in a `finally` so only a component that actually
      // landed is counted — a name that isn't in the registry, or one already
      // installed, is not an install and shouldn't show up as one.
      // 'add' runs from the root of the app, so its own package.json is the one to read
      await this.telemetry(".", "add", name);
    } catch (err) {
      this.stopLoader();
      console.error(colors.red(err));
    }
  }
}

new CLI();