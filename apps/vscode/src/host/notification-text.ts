const UNSAFE_CHARACTERS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

export class NotificationText {
  static withoutLinks(text: string): string {
    return text.replace(/\[/g, '(').replace(/\]/g, ')');
  }

  static printable(text: string): string {
    return text.replace(UNSAFE_CHARACTERS, ' ');
  }
}
