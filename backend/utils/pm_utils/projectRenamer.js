import copyProject from "./projectCopier.js";
import { deleteProject } from "./projectDeleter.js";
import { moveProjectVersions } from "./projectVersions.js";


async function renameProject(currentName, newName) {
  // Copy to new name (preserves all data, throws PROJECT_EXISTS / "does not exist" on errors)
  await copyProject(currentName, { name: newName });

  // The saved versions go with the project, then the original is deleted (only after the copy succeeded)
  await moveProjectVersions(currentName, newName);
  await deleteProject(currentName);

  return { success: true, name: newName };
}

export default renameProject;