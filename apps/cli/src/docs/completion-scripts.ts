/**
 * The shell completion scripts of `operate completion <shell>` (design §17.10). Each script calls
 * `operate __complete <words up to the cursor>` and offers its `value<TAB>description` lines, or
 * falls back to the shell's own path completion for `:files` / `:dirs`.
 */

export const SHELLS = ['bash', 'zsh', 'fish'] as const;
export type Shell = (typeof SHELLS)[number];

const BASH = `# operate completion for bash (3.2 and later). Install: add to ~/.bashrc
#   eval "$(operate completion bash)"
_operate_quote() {
  local quoted
  quoted="$(printf '%q' "$1")"
  # keep a leading ~ unquoted, so the shell still expands it
  if [[ "$quoted" == '\\~'* ]]; then quoted="~\${quoted:2}"; fi
  printf '%s' "$quoted"
}
_operate_complete() {
  local line="\${COMP_LINE:0:COMP_POINT}" cur candidate prefix="" at="" i
  local -a words candidates
  read -r -a words <<< "$line"
  if [[ "$line" =~ [[:space:]]$ ]]; then words+=(""); fi
  cur="\${words[\${#words[@]}-1]}"
  words=("\${words[@]:1}")
  while IFS= read -r candidate; do
    candidates+=("$candidate")
  done < <(operate __complete "\${words[@]}" 2>/dev/null)
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
        candidate="$at$(_operate_quote "$candidate")/"
      else
        candidate="$at$(_operate_quote "$candidate") "
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
complete -o nospace -F _operate_complete operate
`;

const ZSH = `#compdef operate
# operate completion for zsh. Install:
#   mkdir -p ~/.zfunc && operate completion zsh > ~/.zfunc/_operate
#   and in ~/.zshrc, before compinit: fpath=(~/.zfunc $fpath)
_operate() {
  local -a lines candidates prefixes
  local line value ret=1
  lines=("\${(@f)$(operate __complete "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
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
    (( \${#candidates} )) && _describe 'operate' candidates && ret=0
    (( \${#prefixes} )) && _describe 'operate' prefixes -S '' && ret=0
  fi
  return ret
}
if [[ "\${funcstack[1]}" == "_operate" ]]; then
  _operate "$@"
else
  compdef _operate operate
fi
`;

const FISH = `# operate completion for fish. Install:
#   operate completion fish > ~/.config/fish/completions/operate.fish
function __operate_complete
    set -l tokens (commandline -opc)
    set -l current (commandline -ct)
    set -l candidates (operate __complete $tokens[2..-1] "$current" 2>/dev/null)
    if test (count $candidates) -eq 1; and test "$candidates[1]" = ":files"
        __fish_complete_path "$current"
    else if test (count $candidates) -eq 1; and test "$candidates[1]" = ":dirs"
        __fish_complete_directories "$current"
    else
        printf '%s\\n' $candidates
    end
end
complete -c operate -f -a '(__operate_complete)'
`;

export const COMPLETION_SCRIPTS: Readonly<Record<Shell, string>> = {
  bash: BASH,
  zsh: ZSH,
  fish: FISH,
};

/** How to install the script of each shell, for the help and docs/installation.md. */
export const INSTALL_LINES: readonly string[] = [
  'bash: eval "$(operate completion bash)"  in ~/.bashrc (also bash 3.2)',
  'zsh:  mkdir -p ~/.zfunc && operate completion zsh > ~/.zfunc/_operate',
  '      and fpath=(~/.zfunc $fpath) before compinit in ~/.zshrc',
  'fish: operate completion fish > ~/.config/fish/completions/operate.fish',
];
