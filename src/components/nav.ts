import { CalendarDays, Heart, Settings, ShoppingBasket, type LucideIcon } from 'lucide-react';

// The four main tabs, in the floating tab bar.

export type NavId = 'mealplan' | 'groceries' | 'favorites' | 'settings';

export const NAV_ITEMS: Array<{ id: NavId; label: string; icon: LucideIcon }> = [
  { id: 'mealplan', label: 'Meal plan', icon: CalendarDays },
  { id: 'groceries', label: 'Groceries', icon: ShoppingBasket },
  { id: 'favorites', label: 'Favorites', icon: Heart },
  { id: 'settings', label: 'Settings', icon: Settings },
];
