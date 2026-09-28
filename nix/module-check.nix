{ self, pkgs }:
let
  inherit (pkgs) lib;
  evaluate =
    settings:
    (self.inputs.nixpkgs.lib.nixosSystem {
      system = pkgs.stdenv.hostPlatform.system;
      modules = [
        self.nixosModules.default
        {
          system.stateVersion = "26.05";
          users.users.operator = {
            isNormalUser = true;
            home = "/home/operator";
          };
          services.hui = settings;
        }
      ];
    }).config;
  disabled = evaluate { };
  gui = evaluate {
    desktop.enable = true;
    port = 5180;
  };
  service = evaluate {
    enable = true;
    desktop.enable = true;
    user = "operator";
    host = "127.0.0.2";
    port = 5180;
    openFirewall = true;
    autoStart = false;
    environment = {
      PI_CODING_AGENT_DIR = "/home/operator/custom-pi";
    };
    environmentFile = "/run/secrets/hui-env";
  };
  tailnet = evaluate {
    enable = true;
    user = "operator";
    host = "tailnet";
  };
  missingUser = evaluate { enable = true; };
  valid = cfg: lib.all (x: x.assertion || !(lib.hasPrefix "services.hui." x.message)) cfg.assertions;
in
assert !(disabled.systemd.services ? hui);
assert !(gui.systemd.services ? hui);
assert gui.services.hui.package.withDesktop;
assert gui.services.hui.package.gatewayPort == 5180;
assert valid gui && valid service;
assert !(valid missingUser);
assert service.systemd.services.hui.serviceConfig.User == "operator";
assert service.systemd.services.hui.environment.HOME == "/home/operator";
assert service.systemd.services.hui.environment.PI_CODING_AGENT_DIR == "/home/operator/custom-pi";
assert service.systemd.services.hui.serviceConfig.EnvironmentFile == "/run/secrets/hui-env";
assert lib.hasInfix "--host 127.0.0.2 --port 5180"
  service.systemd.services.hui.serviceConfig.ExecStart;
assert service.systemd.services.hui.wantedBy == [ ];
assert builtins.elem 5180 service.networking.firewall.allowedTCPPorts;
assert builtins.elem "tailscaled.service" tailnet.systemd.services.hui.after;
assert !(builtins.elem 4173 tailnet.networking.firewall.allowedTCPPorts);
pkgs.runCommand "hui-module-check" { } ''
  echo "NixOS module: disabled, desktop-only, configured service and tailnet options passed."
  touch "$out"
''
