// Exercise the Linux GTK dependency's C varargs output pointer under optimization.
#[cfg(test)]
mod tests {
    use glib::variant::ToVariant;

    #[test]
    fn borrowed_string_iteration_survives_optimization() {
        let values = ["alpha", "", "فارسی", "last"];
        let variant = values.to_variant();
        assert_eq!(variant.array_iter_str().unwrap().collect::<Vec<_>>(), values);
        assert_eq!(variant.array_iter_str().unwrap().rev().collect::<Vec<_>>(),
                   values.into_iter().rev().collect::<Vec<_>>());
        let mut iter = variant.array_iter_str().unwrap();
        assert_eq!(iter.next(), Some("alpha"));
        assert_eq!(iter.nth(1), Some("فارسی"));
        assert_eq!(iter.next_back(), Some("last"));
        assert_eq!(iter.next(), None);
        assert_eq!(variant.array_iter_str().unwrap().nth_back(1), Some("فارسی"));
        assert_eq!(variant.array_iter_str().unwrap().last(), Some("last"));
        let empty: [&str; 0] = [];
        assert_eq!(empty.to_variant().array_iter_str().unwrap().next(), None);
    }
}
