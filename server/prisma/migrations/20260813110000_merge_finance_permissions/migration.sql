-- Finance was three delegated grants - ACCOUNTING_ACCESS to read the books,
-- MANAGE_JOURNAL to post to them, CLOSE_PERIOD to freeze a month. It is one
-- now: ACCOUNTING_ACCESS covers the whole section.
--
-- The two retired codes have to come out of admins.permissions, not just out of
-- the code. updateAdminPermissions validates the list it is given against
-- ADMIN_PERMISSIONS and rejects anything it does not recognise, so an admin
-- still carrying a retired code would make the permissions dialog fail to save
-- the moment a super_admin opened it.
--
-- Anyone who held either of the retired grants gets ACCOUNTING_ACCESS, so no
-- one loses access they already had.
UPDATE admins
   SET permissions = (
         SELECT COALESCE(array_agg(DISTINCT p), '{}')
           FROM unnest(
                  CASE
                    WHEN permissions && ARRAY['MANAGE_JOURNAL', 'CLOSE_PERIOD']
                      THEN array_append(permissions, 'ACCOUNTING_ACCESS')
                    ELSE permissions
                  END
                ) AS p
          WHERE p NOT IN ('MANAGE_JOURNAL', 'CLOSE_PERIOD')
       ),
       updated_at = now()
 WHERE permissions && ARRAY['MANAGE_JOURNAL', 'CLOSE_PERIOD'];
