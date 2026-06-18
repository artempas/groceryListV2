export interface CategoryDef {
  /** Display name; also the stored value of ListItem.category. */
  name: string
  /** Reference phrase (example products) used to compute the category embedding. */
  reference: string
}

export const CATEGORIES: CategoryDef[] = [
  { name: 'Овощи и фрукты', reference: 'картофель, помидоры, огурцы, яблоки, бананы, зелень, лук, морковь' },
  { name: 'Молочное и яйца', reference: 'молоко, сыр, творог, йогурт, кефир, сметана, сливочное масло, яйца' },
  { name: 'Мясо и рыба', reference: 'курица, говядина, свинина, фарш, рыба, колбаса, сосиски' },
  { name: 'Бакалея', reference: 'крупа, рис, гречка, макароны, мука, сахар, соль, подсолнечное масло, консервы' },
  { name: 'Хлеб и выпечка', reference: 'хлеб, батон, булочки, лаваш, багет' },
  { name: 'Напитки', reference: 'вода, сок, чай, кофе, газировка, лимонад' },
  { name: 'Сладости и снеки', reference: 'шоколад, печенье, конфеты, чипсы, орехи, мармелад' },
  { name: 'Замороженное', reference: 'пельмени, мороженое, замороженные овощи, замороженная пицца' },
  { name: 'Бытовая химия и хозтовары', reference: 'моющее средство, стиральный порошок, губки, мусорные пакеты, фольга' },
  { name: 'Гигиена и уход', reference: 'мыло, шампунь, зубная паста, туалетная бумага, гель для душа' },
]

export const CATEGORY_NAMES: string[] = CATEGORIES.map((c) => c.name)
