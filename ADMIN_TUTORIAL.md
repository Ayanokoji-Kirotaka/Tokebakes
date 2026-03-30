# Toke Bakes Admin Panel - Complete Tutorial

## 📋 Table of Contents

1. [Getting Started](#getting-started)
2. [Featured Items Tab](#featured-items-tab)
3. [Menu Items Tab](#menu-items-tab)
4. [Specials Tab](#specials-tab)
5. [Hero Carousel Tab](#hero-carousel-tab)
6. [Themes Tab](#themes-tab)
7. [Stats Tab](#stats-tab)
8. [Settings Tab](#settings-tab)

---

## Getting Started

### Login Screen

- **Email**: Enter your admin email address
- **Password**: Use your Supabase Auth password
- You must be listed in the `app_admins` table in Supabase to access the admin panel
- Click **Login** to proceed

### Header Navigation

Once logged in, you'll see:

- **Admin Logo & Title**: "Toke Bakes Admin" with the site logo
- **Site Link**: Click to view your live website
- **Logout Button**: Exit the admin panel
- **Sync Badge**: Shows sync status (ready/syncing/synced)
- **Theme Toggle**: Switch between light and dark mode

### Storage Status

At the top of each tab, you'll see:

- **Storage indicator**: Shows how much of your 500MB storage you're using
- **Progress bar**: Visual representation of storage usage

---

## 📌 Featured Items Tab

**Purpose**: Showcase special products on your homepage under "Featured Creations"

### What You Can Do

- ✅ Add new featured items
- ✅ Edit existing items
- ✅ Delete items
- ✅ Manage display order
- ✅ Set active/inactive status
- ✅ Link to menu items
- ✅ Upload custom images

### Form Fields

| Field                | Description                                              | Required? |
| -------------------- | -------------------------------------------------------- | --------- |
| **Title**            | Name of the featured item (e.g., "Chocolate Fudge Cake") | ✅ Yes    |
| **Description**      | Detailed description of the item                         | ✅ Yes    |
| **Linked Menu Item** | Connect to a menu item for automatic price sync          | ❌ No     |
| **Display Order**    | Number to control where it appears (0 = first)           | ❌ No     |
| **Status**           | Set to Active or Inactive to show/hide                   | ❌ No     |
| **Start Date**       | Optional date when item becomes active                   | ❌ No     |
| **End Date**         | Optional date when item becomes inactive                 | ❌ No     |
| **Image**            | Upload product image (Max: 500KB)                        | ❌ No     |

### Action Buttons

- **Add New Featured Item** → Opens form to create a new item
- **Save Item** → Saves changes
- **Cancel** → Closes form without saving
- **Edit** (on item card) → Modify existing item
- **Delete** (on item card) → Permanently remove item
- **Move Up/Down** → Reorder items on the page

---

## 🍽️ Menu Items Tab

**Purpose**: Manage all menu items with prices, categories, and tags

### What You Can Do

- ✅ Add menu items with prices
- ✅ Organize by category
- ✅ Add tags for filtering (e.g., "vegan", "chocolate")
- ✅ Manage product options (sizes, flavors, variations)
- ✅ Control visibility

### Form Fields

| Field             | Description                                       | Required? |
| ----------------- | ------------------------------------------------- | --------- |
| **Title**         | Menu item name                                    | ✅ Yes    |
| **Description**   | Item description                                  | ✅ Yes    |
| **Price (NGN)**   | Price in Nigerian Naira                           | ✅ Yes    |
| **Category**      | Group items (e.g., "pastries", "cakes", "drinks") | ❌ No     |
| **Tags**          | Comma-separated tags for search/filter            | ❌ No     |
| **Status**        | Active or Inactive                                | ❌ No     |
| **Display Order** | Control order on menu page                        | ❌ No     |
| **Image**         | Product photo (Max: 500KB)                        | ❌ No     |

### Product Options (Advanced)

Each menu item can have **Options** like:

- Size variations (Small, Medium, Large)
- Flavor choices (Vanilla, Chocolate, Strawberry)
- Add-on options (Extra topping, Gift wrap)

**How to manage options**:

1. Click **Manage Options** on a menu item
2. Select existing option groups or create new ones
3. Add values (e.g., if option is "Size", add "Small", "Medium", "Large")
4. Save changes

---

## 🏷️ Specials Tab

**Purpose**: Showcase promotional deals and discounts

### What You Can Do

- ✅ Create limited-time offers
- ✅ Set original and discounted prices (discount % auto-calculates)
- ✅ Add custom badges and emoji
- ✅ Set visibility and display order

### Form Fields

| Field                  | Description                                       | Required? |
| ---------------------- | ------------------------------------------------- | --------- |
| **Title**              | Special name (e.g., "Assorted Cupcakes Box of 6") | ✅ Yes    |
| **Price (NGN)**        | Current/discounted price                          | ✅ Yes    |
| **Original Price**     | Full price (optional, shows discount %)           | ❌ No     |
| **Show SPECIAL Badge** | Display special badge on item                     | ❌ No     |
| **Badge Text**         | Custom text ("SPECIAL", "SALE", etc.)             | ❌ No     |
| **Badge Icon**         | Emoji to display on badge (🔥, ⭐, etc.)          | ❌ No     |
| **CTA Label**          | Button text ("Order Now", "Buy Now", etc.)        | ❌ No     |
| **Status**             | Active or Inactive                                | ❌ No     |
| **Display Order**      | Control order on specials page                    | ❌ No     |
| **Image**              | Special product image (Max: 500KB)                | ✅ Yes    |

### Example

```
Title: Valentine's Special Bundle
Price: ₦8,500
Original Price: ₦12,000
Badge: 🔥 HOT DEAL
Shows as: 29% OFF badge on website
```

---

## 🎠 Hero Carousel Tab

**Purpose**: Manage rotating background images in the hero section

### What You Can Do

- ✅ Upload carousel images
- ✅ Add alternative text (for accessibility)
- ✅ Optional: Add titles and subtitles
- ✅ Set custom links
- ✅ Control rotation speed and order

### Form Fields

| Field               | Description                                 | Required? |
| ------------------- | ------------------------------------------- | --------- |
| **Alt Text**        | Image description (for accessibility & SEO) | ✅ Yes    |
| **Title**           | Hero headline over image                    | ❌ No     |
| **Subtitle**        | Supporting text under headline              | ❌ No     |
| **Link (Optional)** | URL to navigate to when clicked             | ❌ No     |
| **Status**          | Active or Inactive                          | ❌ No     |
| **Display Order**   | Control which image shows first             | ❌ No     |
| **Image**           | Background image file (Max: 500KB)          | ✅ Yes    |

### Best Practices

- Use high-quality images (recommended: 1920x600px or larger)
- Write descriptive alt text for accessibility
- Add titles to guide visitors
- Set 2-5 images for smooth rotation

---

## 🎨 Themes Tab

**Purpose**: Change the visual appearance of your entire website

### Available Themes

| Theme                | Description                   | Best For                    |
| -------------------- | ----------------------------- | --------------------------- |
| **Default**          | Orange bakery theme           | General use (always active) |
| **Valentine's Day**  | Romantic pink & red           | February 14th               |
| **Ramadan**          | Green & gold Islamic colors   | Ramadan season              |
| **Christmas**        | Red & green festive           | December holidays           |
| **Halloween**        | Orange & purple spooky        | October 31st                |
| **Independence Day** | Green & white Nigerian colors | Independence celebrations   |

### How to Switch Themes

1. Navigate to **Themes Tab**
2. Browse available theme cards
3. Click **Activate** on the desired theme
4. Changes apply **immediately** to all visitors
5. The activated theme shows "ACTIVE" status

### What Changes?

When you activate a theme:

- ✅ Primary and accent colors
- ✅ Logo appearance
- ✅ Button styles
- ✅ Background colors
- ✅ Typography
- ❌ Content (featured items, menu, specials stay the same)

---

## 📊 Stats Tab

**Purpose**: View website analytics and traffic data

### Available Statistics

#### Site Counts

- **Total Featured Items**: Number of featured products
- **Total Menu Items**: Number of menu items
- **Total Specials**: Number of active specials
- **Total Carousel Images**: Number of hero images

#### Daily Statistics (Last 30 days)

- **Page Views**: How many times pages were viewed
- **Unique Visitors**: Individual visitors to your site
- **Conversions**: Order completions
- **Top Products**: Most viewed/ordered items

### What You Can Do

- ✅ View traffic trends
- ✅ Monitor product popularity
- ✅ Track visitor engagement
- ✅ Identify best-selling items
- ✅ Refresh stats manually

---

## ⚙️ Settings Tab

**Purpose**: Manage system settings and data

➡️ **Password Management**: Admin passwords are managed directly in Supabase Auth. To change your password, log into your Supabase account and update it there.

### 1️⃣ Data Management

#### Export All Data

- **What it does**: Downloads all your content as a JSON file
- **Use case**: Backup your data before major changes
- **File format**: `tokebakes-backup-[date].json`

#### Import Data

- **What it does**: Uploads previously exported data
- **⚠️ Warning**: Replaces ALL current data
- **Use case**: Restoring from backup

#### Reset to Defaults

- **What it does**: Erases all content and restores factory defaults
- **⚠️ Warning**: This action CANNOT be undone!
- **Use case**: Starting completely fresh (rarely used)

### 2️⃣ Admin Access Helper

**For Supabase administrators only**

Purpose: Grant admin access to other users

Steps:

1. Create a new user in Supabase Auth
2. Copy their User ID (UUID)
3. Paste the UUID in the **Auth User ID** field
4. Click **Grant Admin Access**
5. They can now login to this admin panel

### 3️⃣ System Info

**View system status and content summary**

Shows:

- 📦 **Version**: Current admin panel version (2.0.0)
- 💾 **Storage Used**: Total MB used / 500MB available
- 📈 **Items Count**:
  - Featured items: [number]
  - Menu items: [number]
  - Specials: [number]
  - Carousel images: [number]

---

## 🎯 Quick Tips & Best Practices

### Image Management

- ✅ Use compressed/optimized images (smaller file sizes)
- ✅ Recommended formats: JPG, PNG, or WebP
- ✅ Maximum file size per image: 2MB (depending on item type)
- ✅ Preview images appear after upload
- ✅ Images are automatically stored in the cloud

### Ordering & Display

- Lower numbers appear first
- Leave "Display Order" empty for auto-ordering
- Drag & drop or use up/down arrows to reorder items

### Status & Scheduling

- Set **Status to Inactive** to hide items without deleting
- Use **Start/End Dates** for time-limited promotions
- Changes take effect immediately on the live site

### Linking Content

- **Featured Items** can link to **Menu Items**
- When linked, updates to menu item prices automatically reflect in featured view
- Unlink by selecting "None" in dropdown

### Sync Indicator

- 🟢 **"Sync: ready"** = All changes saved
- 🔵 **"Syncing..."** = Changes being applied
- 🔴 **"Sync failed"** = Try again or contact support

---

## 🆘 Troubleshooting

### Can't Login?

- Verify email is correct
- Ensure you're in Supabase `app_admins` table
- Check Caps Lock
- Try resetting password in Supabase

### Image Not Uploading?

- Check file size (max 500KB-2MB)
- Verify file format (JPG, PNG, WebP)
- Try refreshing page
- Check internet connection

### Changes Not Showing on Site?

- Click refresh on your website
- Clear browser cache (Ctrl+Shift+Delete)
- Check Sync badge - should show "Up to date (vX)"
- Wait 5-10 seconds for update

### Lost Admin Access?

- Ask another admin to readd you via Settings Tab
- Or contact your Supabase administrator

---

## 📞 Support

For issues or questions:

1. Check Supabase status
2. Verify internet connection
3. Clear browser cache and try again
4. Contact your Supabase administrator

---

**Last Updated**: March 9, 2026
**Admin Panel Version**: 2.0.0
