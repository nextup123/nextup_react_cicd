# Robot folders (round 17)

nextup-react now keeps the live project in `<home>/active_project_configs`
(`/home/nextup/active_project_configs` on the robot). `<home>` is the home folder of the
user that runs the app; `NEXTUP_HOME` overrides it, `NEXTUP_ACTIVE_PROJECT` overrides the
active project folder alone, `NEXTUP_USER_CONFIG_FILES` the user_config_files folder.
If the app runs as root (a system service), set `NEXTUP_HOME=/home/nextup`.

## Layout

```
/home/nextup/active_project_configs/          the active project (copied from projects/<name>)
  .session.yaml  logs.json  project.yaml  template_with_uids.json  do_di_with_uids.json
  planning_data/  points.yaml points_undo.yaml programs.yaml (+ .bak / .tmp while saving)
  control_data/   template.xml main_tree.xml do_di.xml do_di_backup.xml do_di_undo.xml <other>.xml
  plc_data/       program.yaml   this project's NextPLC program
                  retain.yaml    the PLC's retained registers

/home/nextup/user_config_files/
  active_project.yaml  live_logs.json  nodes.json
  error_container/     logs, records, black box, commands, description (Diagnostics)
  plc/                 programs/*.yaml   program library, shared by every project
                       scenarios/*.sim   test scenarios
                       blocks/*.yaml     your own blocks
                       backups/          project programs replaced by "Use in this project"
  projects/<name>/     project.yaml + a copy of everything in active_project_configs
  .project_backups/<name>/<timestamp>/   one per manual Save (autosave makes none)
```

Removed (the app neither reads nor writes them any more, and cleans them out of old projects
at start-up): `security/web_frontent_passwords.json`, `ros_node_controller_monitor/monitor.yaml`
(and the start-up "waiting for nodes" screen and the Diagnostics ROS monitor tab),
`planning_data/articles/mapped_data.yaml`, and in projects `emergency_manager.yaml`,
`joint_velocities_tuner.yaml`, `controller_dashboard.yaml`, `planning_data/paths.yaml`,
`plan_path.xml`, `plan_path_undo.xml`, `control_data/run_path.xml`, `group_run_path.xml`,
`nodes.json`, `run_path_with_uids.json`, `debuggers/` (Diagnostics uses error_container).
template.xml no longer includes run_path.xml.

## ROS packages that still use the old folder

These read `/home/nextup/NextupRobot/src/active_project_configs` by default. The quickest fix,
with no rebuild, is a link from the old place to the new one:

```
mv /home/nextup/NextupRobot/src/active_project_configs /home/nextup/active_project_configs   # once
ln -s /home/nextup/active_project_configs /home/nextup/NextupRobot/src/active_project_configs
```

Or change their settings:

| package | setting |
|---|---|
| control_logic_bt | env `NEXTUP_CONFIG_DIR=/home/nextup/active_project_configs` or param `config_dir` |
| motion_server_pkg | params `points_file`, `homes_file`, `goto_config_file` (config/motion_server_params.yaml) |
| utility_pkg | `points_file` (config/utility_params.yaml); emergency_manager reads `emergency_manager.yaml` there, which is removed (it logs a load error and does nothing) |
| nextup_moveit_config | `limits_file` in config/ros2_controllers.yaml |
| nextplc | see below |

## nextplc node parameters (config/nextplc.yaml)

```yaml
    program_file: "/home/nextup/active_project_configs/plc_data/program.yaml"
    retain_file:  "/home/nextup/active_project_configs/plc_data/retain.yaml"
    block_dirs: ["/home/nextup/user_config_files/plc/blocks"]
```

Until the node has these, the app loads this project's program into the PLC itself (at start in
Robot mode and every time another project is loaded), but the node keeps its retained registers
in the old file.
