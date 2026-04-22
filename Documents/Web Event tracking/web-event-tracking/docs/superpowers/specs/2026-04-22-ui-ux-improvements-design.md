# UI/UX Improvements Design Spec

## 1. Mobile Calendar Optimization (P0)
**Problem:** The `dayGridMonth` view of FullCalendar is not responsive on mobile devices, causing text to overlap and become unreadable.
**Solution:**
- Add an effect or logic to switch the calendar's `initialView` to `listWeek` or `timeGridDay` on small screens (e.g., width < 768px).
- Alternatively, FullCalendar has a responsive hook or we can use a window resize listener to change the view dynamically via `calendarRef.current.getApi().changeView('listWeek')`.

## 2. Navigation & Visual Polish (P3)
**Problem:** Users can't easily tell which page they are currently on because the active state on the navigation links is missing.
**Solution:**
- In `components/app-shell.tsx`, use Next.js's `usePathname` from `next/navigation`.
- Apply a distinct active style (e.g., background color `bg-panel-soft` and stronger text color) to the link that matches the current pathname.

## 3. Empty States & Feedback (P2)
**Problem:** The dashboard and calendar feel empty and confusing when there are no events. The sidebar in the calendar just says "เลือกอีเวนท์บนปฏิทินเพื่อดูรายละเอียด".
**Solution:**
- Add a visually pleasing empty state to the calendar sidebar, perhaps an icon or illustration, with a clearer prompt to select an event or add a new one.
- In the dashboard, if `stats.events.length === 0`, show a welcome message with a prominent "Add First Event" button.