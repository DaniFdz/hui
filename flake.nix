{
  description = "HUI — browser-first coding-agent gateway";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: import nixpkgs { inherit system; };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        rec {
          hui = pkgs.callPackage ./nix/package.nix { };
          hui-desktop = hui.override { withDesktop = true; };
          default = hui;
        }
      );

      nixosModules.default = import ./nix/module.nix { inherit self; };

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.hui}/bin/hui";
          meta.description = "HUI command-line interface and web gateway";
        };
        desktop = {
          type = "app";
          program = toString (
            (pkgsFor system).writeShellScript "hui-desktop" ''
              exec ${self.packages.${system}.hui-desktop}/bin/hui desktop "$@"
            ''
          );
          meta.description = "HUI Electron application";
        };
      });

      checks = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          desktop =
            pkgs.runCommand "hui-desktop-smoke"
              {
                nativeBuildInputs = [
                  pkgs.nodejs_24
                  pkgs.xvfb-run
                ];
              }
              ''
                timeout 90s xvfb-run -a -s "-screen 0 1600x1000x24" node ${./nix/desktop-smoke.mjs} ${self.packages.${system}.hui-desktop} ${
                  self.packages.${system}.hui-desktop.electronPackage
                }/bin
                touch "$out"
              '';
          module = import ./nix/module-check.nix { inherit self pkgs; };
          configured = pkgs.runCommand "hui-configured-smoke" { nativeBuildInputs = [ pkgs.nodejs_24 ]; } ''
            node ${./nix/smoke.mjs} ${
              self.packages.${system}.hui.override {
                gatewayHost = "127.0.0.2";
                gatewayPort = 5187;
              }
            } ${pkgs.bash}/bin/bash configured
            touch "$out"
          '';
          package =
            pkgs.runCommand "hui-package-smoke"
              {
                nativeBuildInputs = [ pkgs.nodejs_24 ];
              }
              ''
                node ${./nix/smoke.mjs} ${self.packages.${system}.hui} ${pkgs.bash}/bin/bash
                touch "$out"
              '';
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs_24
              git
              ripgrep
              fd
              python3
              pkg-config
            ];
            # npm's prebuilt native modules need libstdc++ on NixOS.
            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ];
          };
        }
      );
    };
}
