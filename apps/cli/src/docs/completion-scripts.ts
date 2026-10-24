/**
 * The shell completion scripts of `pulse-cli completion <shell>`. Each script calls
 * `pulse-cli __complete <words up to the cursor>` and offers its `value<TAB>description` lines, or
 * falls back to the shell's own path completion for `:files` / `:dirs`.
 */

export const SHELLS = ["bash", "zsh", "fish"] as const
export type Shell = (typeof SHELLS)[number]

const BASH = `# pulse-cli completion for bash (3.2 and later). Install: add to ~/.bashrc
#   eval "$(pulse-cli completion bash)"
_pulse_cli_quote() {
  local quoted
  quoted="$(printf '%q' "$1")"
  # keep a leading ~ unquoted, so the shell still expands it
  if [[ "$quoted" == '\\~'* ]]; then quoted="~\${quoted:2}"; fi
  printf '%s' "$quoted"
}
_pulse_cli_complete() {
  local line="\${COMP_LINE:0:COMP_POINT}" cur candidate prefix="" at="" i
  local -a words candidates
  read -r -a words <<< "$line"
  if [[ "$line" =~ [[:space:]]$ ]]; then words+=(""); fi
  cur="\${words[\${#words[@]}-1]}"
  words=("\${words[@]:1}")
  while IFS= read -r candidate; do
    candidates+=("$candidate")
  done < <(pulse-cli __complete "\${words[@]}" 2>/dev/null)
  COMPREPLY=()
  # bash replaces only the text after the last word break character (":" and "="; bash keeps a leading "@" in the word)
  for (( i = \${#cur} - 1; i >= 0; i-- )); do
    case "\${cur:i:1}" in
      :|=) if [[ "$COMP_WORDBREAKS" == *"\${cur:i:1}"* ]]; then prefix="\${cur:0:i+1}"; break; fi ;;
    esac
  done
  if [[ \${#candidates[@]} -eq 1 && ( "\${candidates[0]}" == ":files" || "\${candidates[0]}" == ":dirs" ) ]]; then
    # a value like --body @file: complete the path after "@" and keep the "@"
    if [[ "$cur" == @* ]]; then at="@"; fi
    while IFS= read -r candidate; do
      if [[ -d "\${candidate/#\\~/$HOME}" ]]; then
        candidate="$at$(_pulse_cli_quote "$candidate")/"
      else
        candidate="$at$(_pulse_cli_quote "$candidate") "
      fi
      COMPREPLY+=("\${candidate#"$prefix"}")
    done < <(if [[ "\${candidates[0]}" == ":dirs" ]]; then compgen -d -- "\${cur#@}"; else compgen -f -- "\${cur#@}"; fi)
    return
  fi
  for candidate in "\${candidates[@]}"; do
    candidate="\${candidate%%$'\\t'*}"
    # a prefix such as activity: or task: is completed further, without a space
    if [[ "$candidate" != *: ]]; then candidate="$candidate "; fi
    COMPREPLY+=("\${candidate#"$prefix"}")
  done
}
# -o nospace: the function adds the space itself (bash 3.2 has no compopt)
complete -o nospace -F _pulse_cli_complete pulse-cli
`

const ZSH = `#compdef pulse-cli
# pulse-cli completion for zsh. Install:
#   mkdir -p ~/.zfunc && pulse-cli completion zsh > ~/.zfunc/_pulse-cli
#   and in ~/.zshrc, before compinit: fpath=(~/.zfunc $fpath)
_pulse-cli() {
  local -a lines candidates prefixes
  local line value ret=1
  lines=("\${(@f)$(pulse-cli __complete "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  if [[ \${#lines} -eq 1 && "\${lines[1]}" == ":files" ]]; then
    # a value like --body @file: complete the path after "@"
    compset -P '@'
    _files && ret=0
  elif [[ \${#lines} -eq 1 && "\${lines[1]}" == ":dirs" ]]; then
    _files -/ && ret=0
  else
    for line in "\${lines[@]}"; do
      [[ -z "$line" ]] && continue
      value="\${line%%$'\\t'*}"
      # a prefix such as activity: or task: is completed further, without a space
      if [[ "$value" == *: ]]; then
        prefixes+=("\${value//:/\\\\:}:\${line#*$'\\t'}")
      else
        candidates+=("\${value//:/\\\\:}:\${line#*$'\\t'}")
      fi
    done
    (( \${#candidates} )) && _describe 'pulse-cli' candidates && ret=0
    (( \${#prefixes} )) && _describe 'pulse-cli' prefixes -S '' && ret=0
  fi
  return ret
}
if [[ "\${funcstack[1]}" == "_pulse-cli" ]]; then
  _pulse-cli "$@"
else
  compdef _pulse-cli pulse-cli
fi
`

const FISH = `# pulse-cli completion for fish. Install:
#   pulse-cli completion fish > ~/.config/fish/completions/pulse-cli.fish
function __pulse_cli_complete
    set -l tokens (commandline -opc)
    set -l current (commandline -ct)
    set -l candidates (pulse-cli __complete $tokens[2..-1] "$current" 2>/dev/null)
    if test (count $candidates) -eq 1; and test "$candidates[1]" = ":files"
        __fish_complete_path "$current"
    else if test (count $candidates) -eq 1; and test "$candidates[1]" = ":dirs"
        __fish_complete_directories "$current"
    else
        printf '%s\\n' $candidates
    end
end
complete -c pulse-cli -f -a '(__pulse_cli_complete)'
`

export const COMPLETION_SCRIPTS: Readonly<Record<Shell, string>> = {
  bash: BASH,
  zsh: ZSH,
  fish: FISH,
}

/** How to install the script of each shell, for the help and docs/cli/installation.md. */
export const INSTALL_LINES: readonly string[] = [
  'bash: eval "$(pulse-cli completion bash)"  in ~/.bashrc (also bash 3.2)',
  "zsh:  mkdir -p ~/.zfunc && pulse-cli completion zsh > ~/.zfunc/_pulse-cli",
  "      and fpath=(~/.zfunc $fpath) before compinit in ~/.zshrc",
  "fish: pulse-cli completion fish > ~/.config/fish/completions/pulse-cli.fish",
]
