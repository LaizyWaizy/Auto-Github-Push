# Auto GitHub Push

A VS Code sidebar extension for reviewing a project before preparing, committing, or pushing it to GitHub.

## Use In VS Code

Open the project folder you want to push, then open the **Auto GitHub Push** icon in the activity bar.

Use the sidebar to:

- scan for sensitive-looking info, or scan + commit + push from the main button when the project already has an `origin` remote
- choose which `.gitignore` rules to apply
- make plain public CSV copies
- initialize Git
- create a GitHub repo

You can also press `Ctrl+Shift+P` and run:

```text
Auto GitHub Push: Open
```

## Legacy Desktop App

```powershell
npm start
```

By default, the app scans the parent folder of this project. To scan a different folder:

```powershell
$env:PROJECTS_DIR="C:\Users\jm774\Documents\Code"; npm start
```

## Current Phases

- Phase 1: lists folders and safety status.
- Phase 2: opens the selected project in VS Code.
- Phase 3: scans a folder for sensitive-looking files or secrets before creating a local Git repository.
- Phase 4: creates or fixes `.gitignore`.
- Phase 5: commits and pushes only after a clean sensitive-info scan. In the VS Code sidebar, an existing repo with an `origin` remote gets one main **Scan + Commit + Push** button.
- Phase 6: optionally adds or removes a Windows startup script.

## Private CSV Files

To keep personal CSV data off GitHub, name the real file with one of these suffixes:

```text
contacts.private.csv
contacts.personal.csv
contacts.sensitive.csv
```

Before creating a repo, committing, or pushing, the app creates a plain public copy beside it:

```text
contacts.csv
```

The public copy keeps the same header row and removes the data rows. The private source file is added to `.gitignore`, so `git add --all` does not upload it.

## Build The VS Code Extension

Open this folder in VS Code, then press `F5` and choose **VS Code Extension Development** if prompted. A new Extension Development Host window opens with the Auto GitHub Push sidebar in the activity bar.

## Credit
Most of the project was made by me, with AI helping on the JavaScript. The UI was me LMAO. I suck at anything with java script so this was mainly just ai doing the backend for me.



To build a local `.vsix` package:

```powershell
npm run package-extension
```

Then install the generated file:

```powershell
code --install-extension .\auto-github-push-0.1.0.vsix
```
