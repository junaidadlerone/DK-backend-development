-- Function to handle new user creation (specifically for Google OAuth)
-- This function runs after a new user is inserted into auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_org_id uuid;
BEGIN
  -- Check if user is signing up via email (handled by signUp edge function)
  -- The signUp edge function handles profile and organization creation manually
  -- so we don't want to duplicate that logic here.
  IF NEW.raw_app_meta_data->>'provider' = 'email' THEN
    RETURN NEW;
  END IF;

  -- Create profile for the new user (assume ADMIN role for OAuth signups as they are new accounts)
  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    NEW.id,
    'ADMIN',
    NEW.raw_user_meta_data->>'full_name'
  );

  -- Create organization for the new user
  INSERT INTO public.organizations (owner_id, business_email)
  VALUES (
    NEW.id,
    NEW.email
  )
  RETURNING id INTO new_org_id;

  -- Create default app content for the new organization
  PERFORM public.create_default_app_content(new_org_id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function on new user creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();