# Template Editor

The template editor is a drag-and-drop design tool for creating postcard designs. You access it by creating a new template or clicking Edit on an existing one.

## Layout

The editor has three panels:

- **Left panel**: design tool palette — element types you can add to the canvas
- **Center panel**: live postcard canvas — drag, resize, and arrange elements here
- **Right panel**: properties — settings for the currently selected element (color, size, font, etc.)

At the top of the canvas, tabs let you switch between **Front** and **Back** sides.

---

## Adding Elements

Click any element type in the left panel to add it to the canvas:

| Element | Description |
|---|---|
| **Text** | Text box — set font, size, weight, color, alignment, shadow |
| **Image** | Upload a photo or image file |
| **QR Code** | Auto-generated QR code linked to your campaign tracking URL |
| **Shape** | Rectangle, circle, triangle, star, heart, hexagon, or line |
| **Icon** | Searchable icon library |

---

## Dynamic Variables

Dynamic variables are placeholders that get filled in automatically when the campaign is launched. This allows you to create one template and reuse it for different campaigns.

To use a variable, type `{{variable_name}}` in a text element, or select it from the variable picker in the text element's properties.

**Available variables:**

| Variable | What It Fills In |
|---|---|
| `{{business_name}}` | Your organization's business name |
| `{{offer_headline}}` | The campaign's main headline (entered during campaign creation) |
| `{{offer_description}}` | Body copy for your offer |
| `{{start_date}}` | Offer or campaign start date |
| `{{end_date}}` | Offer or campaign end date |
| `{{cta_text}}` | Call-to-action text (e.g., "Call Us Today!") |
| `{{phone}}` | Your business phone number |
| `{{website}}` | Your business website URL |
| `{{disclaimer_text}}` | Fine print or legal disclaimers |
| `{{qr_url}}` | The campaign's unique tracking URL (linked to the QR code element) |
| `{{before_image_id}}` | Before photo from a linked referral |
| `{{after_image_id}}` | After photo from a linked referral |

---

## Adding a QR Code

1. Click the QR Code element in the left panel
2. The QR element appears on the canvas
3. In the right properties panel, link it to the `{{qr_url}}` variable
4. Each campaign that uses this template will have its own unique QR code

---

## Return Address (Required on Back)

The back of the postcard must include a return address. The return address is your business's official mailing address (set in Settings → Organization). You can add a return address text element and populate it with your address variables.

If no return address is present on the back, the template cannot be used in a campaign.

---

## Saving Your Work

Click **Save** frequently — unsaved changes will be lost if you navigate away or close the browser. There is no auto-save in the template editor.

---

## Tips for Good Postcard Design

- Use high-contrast colors — postcards are printed, not backlit screens
- Keep headlines to 5–8 words
- Make the call-to-action obvious (large button or text, prominent placement)
- Leave bleed space (small margin) around all edges to prevent content from being cut during printing
- Test variable substitution by viewing a campaign preview before launch
