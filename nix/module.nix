{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib)
    mkEnableOption
    mkIf
    mkMerge
    mkOption
    types
    ;
  cfg = config.services.hui;
  knownUser = cfg.user != null && builtins.hasAttr cfg.user config.users.users;
  home = if knownUser then config.users.users.${cfg.user}.home else "/var/empty";
in
{
  options.services.hui = {
    enable = mkEnableOption "the HUI gateway system service";
    desktop.enable = mkEnableOption "the HUI Electron application and desktop entry (independent of the service)";
    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.hui.override {
        withDesktop = cfg.desktop.enable;
        gatewayHost = cfg.host;
        gatewayPort = cfg.port;
      };
      defaultText = lib.literalExpression "hui.override { withDesktop = config.services.hui.desktop.enable; gatewayHost = config.services.hui.host; gatewayPort = config.services.hui.port; }";
      description = "HUI package to install and run. Custom packages must provide bin/hui.";
    };
    host = mkOption {
      type = types.str;
      default = "127.0.0.1";
      example = "tailnet";
      description = "Specific listen IP, localhost, or tailnet. Wildcard addresses are not supported by HUI.";
    };
    port = mkOption {
      type = types.ints.between 1 65535;
      default = 4173;
      description = "Gateway HTTP port.";
    };
    user = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "hui";
      description = "Existing account that owns the gateway and PI state. Required when the service is enabled; no account is created.";
    };
    group = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = "Optional service group; by default systemd uses the account's primary group.";
    };
    workingDirectory = mkOption {
      type = types.str;
      default = home;
      defaultText = lib.literalExpression "config.users.users.<user>.home";
      description = "Existing working directory for the gateway service.";
    };
    autoStart = mkOption {
      type = types.bool;
      default = true;
      description = "Start the enabled service at boot. Otherwise start it explicitly with systemctl.";
    };
    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Open the configured TCP port in the NixOS firewall.";
    };
    environment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      example = {
        PI_CODING_AGENT_DIR = "/home/hui/.pi/agent";
      };
      description = "Non-secret service environment, including optional XDG and PI directory overrides. Values enter the Nix store.";
    };
    vscode.package = mkOption {
      type = types.nullOr types.package;
      default = null;
      example = lib.literalExpression "pkgs.openvscode-server";
      description = "A VS Code server for the Work pane's VS Code view, put on the service's PATH, where HUI finds openvscode-server. Null leaves the view to a path set in HUI's Settings, an installed VS Code, or the openvscode-server HUI downloads on request.";
    };
    environmentFile = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "/run/secrets/hui-env";
      description = "Optional systemd environment file read at runtime; use this for credentials instead of literal Nix values.";
    };
  };

  config = mkMerge [
    (mkIf (cfg.enable || cfg.desktop.enable) {
      assertions = [
        {
          assertion = cfg.host != "" && cfg.host != "0.0.0.0" && cfg.host != "::";
          message = "services.hui.host must be a specific address, localhost, or tailnet.";
        }
      ];
      environment.systemPackages = [ cfg.package ];
    })
    (mkIf cfg.enable {
      assertions = [
        {
          assertion = knownUser;
          message = "services.hui.user must name an existing users.users account.";
        }
      ];
      networking.firewall.allowedTCPPorts = lib.optional cfg.openFirewall cfg.port;
      systemd.services.hui = {
        description = "HUI coding-agent gateway";
        wantedBy = lib.optional cfg.autoStart "multi-user.target";
        wants = [ "network-online.target" ];
        after = [ "network-online.target" ] ++ lib.optional (cfg.host == "tailnet") "tailscaled.service";
        path = [
          pkgs.git
          pkgs.gh
          pkgs.bash
        ]
        ++ lib.optional (cfg.host == "tailnet") pkgs.tailscale
        ++ lib.optional (cfg.vscode.package != null) cfg.vscode.package;
        environment = {
          HOME = home;
        }
        // cfg.environment;
        serviceConfig = {
          Type = "simple";
          User = cfg.user;
          WorkingDirectory = cfg.workingDirectory;
          ExecStart = lib.escapeShellArgs [
            "${cfg.package}/bin/hui"
            "gateway"
            "run"
            "--host"
            cfg.host
            "--port"
            (toString cfg.port)
          ];
          Restart = "on-failure";
          RestartSec = 3;
          KillMode = "control-group";
          TimeoutStopSec = 30;
          UMask = "0077";
        }
        // lib.optionalAttrs (cfg.group != null) { Group = cfg.group; }
        // lib.optionalAttrs (cfg.environmentFile != null) { EnvironmentFile = cfg.environmentFile; };
      };
    })
  ];
}
