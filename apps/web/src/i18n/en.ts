/** English messages. Keys are dotted paths; `{name}` placeholders are filled by `t()`. */
export const en = {
  "common.cancel": "Cancel",
  "common.selected": "Selected",

  "profile.personalInfo": "Personal info",
  "profile.firstName": "First name",
  "profile.lastName": "Last name",
  "profile.firstNameRequired": "Enter your first name",
  "profile.email": "Email",
  "profile.emailHint": "The email you sign in with",
  "profile.saveError": "Couldn't save your changes. Try again.",

  "profile.photo.upload": "Upload photo",
  "profile.photo.change": "Change photo",
  "profile.photo.remove": "Remove",
  "profile.photo.cropTitle": "Crop your photo",
  "profile.photo.zoom": "Zoom",
  "profile.photo.save": "Save photo",
  "profile.photo.wrongType": "Choose a JPEG, PNG, WebP or GIF image",
  "profile.photo.saveError": "Couldn't update your photo. Try again.",

  "profile.language": "App language",
  "profile.language.description": "The language Flolist uses",
  "profile.language.system": "System default",

  "profile.weekStart": "First day of the week",
  "profile.weekStart.description": "Used by My Week, the calendar and “Next week” due dates",
  "profile.weekStart.system": "System default ({day})",

  "profile.timezone": "Time zone",
  "profile.timezone.description": "Used for due dates, reminders and daily emails",
  "profile.timezone.deviceDiffers": "This device is set to {zone}.",
  "profile.timezone.useDevice": "Use it",
  "profile.timezone.change": "Time zone: {zone}",
  "profile.timezone.search": "Search time zones",
  "profile.timezone.none": "No matching time zone",
} as const satisfies Record<string, string>;
