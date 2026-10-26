//projectCreator.js

import fs from "fs-extra";
import path from "node:path";
import yaml from "js-yaml";

import { PROJECTS_ROOT, TEMPLATE_PATH, DEFAULTS_DIR } from "./paths.js";
import { generateFromTemplate } from "./projectTemplateGenerator.js";


async function createNewProject(projectData) {
  const {
    name,
    owner,
    description = "",
    project_type = "standard",
  } = projectData;

  if (!name || !owner) {
    throw new Error("Project name and owner are required");
  }

  if (!["standard", "blank"].includes(project_type)) {
    throw new Error("Invalid project_type");
  }

  const projectPath = path.join(PROJECTS_ROOT, name);

  if (await fs.pathExists(projectPath)) {
    const err = new Error(`A project named "${name}" already exists`);
    err.code = "PROJECT_EXISTS";
    throw err;
  }

  await fs.ensureDir(projectPath);

  const projectYaml = {
    name,
    owner,
    description,
    project_type,
    created_at: new Date().toISOString(),
    version: "1.0.0",
    project_version: "1.0.0",
  };

  await fs.writeFile(
    path.join(projectPath, "project.yaml"),
    yaml.dump(projectYaml),
    "utf8"
  );

  const template = await fs.readJson(TEMPLATE_PATH);

  const defaultsPath = DEFAULTS_DIR;

  await generateFromTemplate(
    template,
    projectPath,
    defaultsPath,
    project_type
  );

  return {
    success: true,
    name,
    projectPath,
    project_type,
  };
}

export { createNewProject };