# hui's bash completion: it asks the CLI for the words it accepts, so a new command needs no change here. The
# installed package leaves it in share/bash-completion/completions/hui, which bash-completion loads on demand;
# otherwise add `eval "$(hui completion bash)"` to ~/.bashrc.
# Bash 3.2 (macOS's own) has neither mapfile nor associative arrays, and needs neither: candidates are one word each.
_hui_completions() {
  local candidates
  COMPREPLY=()
  candidates=$(command hui __complete "${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null) || return 0
  [ -n "$candidates" ] || return 0
  COMPREPLY=($(compgen -W "$candidates" -- "${COMP_WORDS[COMP_CWORD]}"))
}
# -o default keeps file names for the flags that take a path, such as --from and --out.
complete -o default -F _hui_completions hui
