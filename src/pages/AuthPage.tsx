import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Mail, Lock, User, ArrowRight, ShoppingBag, Phone, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { z } from 'zod';

const emailSchema = z.object({
  email: z.string().email('সঠিক ইমেইল দিন'),
  password: z.string().min(6, 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে'),
});

const phoneSchema = z.object({
  phone: z.string().regex(/^01[3-9]\d{8}$/, 'সঠিক ফোন নম্বর দিন (01XXXXXXXXX)'),
  password: z.string().min(6, 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে'),
});

const signUpSchema = z.object({
  fullName: z.string().min(2, 'নাম কমপক্ষে ২ অক্ষরের হতে হবে').max(100),
  email: z.string().email('সঠিক ইমেইল দিন').max(255).optional().or(z.literal('')),
  phone: z.string().regex(/^01[3-9]\d{8}$/, 'সঠিক ফোন নম্বর দিন').optional().or(z.literal('')),
  password: z.string().min(6, 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে').max(100),
}).refine((data) => data.email || data.phone, {
  message: 'ইমেইল অথবা ফোন নম্বর অন্তত একটি দিতে হবে',
  path: ['email'],
});

const AuthPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [loginMethod, setLoginMethod] = useState<'email' | 'phone'>('phone');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
  });
  const [forgotEmail, setForgotEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { signIn, signUp, user, isAdmin, isLoading: isAuthLoading } = useAuth();
  const navigate = useNavigate();

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthLoading) return;

    if (user) {
      navigate(isAdmin ? '/admin' : '/my-account', { replace: true });
    }
  }, [user, isAdmin, isAuthLoading, navigate]);

  const validateForm = () => {
    try {
      if (isLogin) {
        if (loginMethod === 'email') {
          emailSchema.parse({ email: formData.email, password: formData.password });
        } else {
          phoneSchema.parse({ phone: formData.phone, password: formData.password });
        }
      } else {
        signUpSchema.parse(formData);
      }
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    setIsLoading(true);

    try {
      if (isLogin) {
        // For phone login, convert to email format (phone@phone.local)
        const loginEmail = loginMethod === 'phone' 
          ? `${formData.phone}@phone.local` 
          : formData.email;
        
        const { error } = await signIn(loginEmail, formData.password);
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            toast.error('ভুল ইমেইল/ফোন অথবা পাসওয়ার্ড');
          } else if (error.message.includes('Email not confirmed')) {
            toast.error('আপনার ইমেইল যাচাই করুন');
          } else {
            toast.error('লগইন ব্যর্থ হয়েছে');
          }
        } else {
          toast.success('সফলভাবে লগইন হয়েছে!');
          // Redirect handled by auth state effect to avoid role-check race conditions
        }
      } else {
        // Use email if provided, otherwise use phone as email format
        const signUpEmail = formData.email || `${formData.phone}@phone.local`;
        const { error } = await signUp(signUpEmail, formData.password, formData.fullName, formData.phone || undefined);
        if (error) {
          if (error.message.includes('already registered')) {
            toast.error('এই ইমেইল/ফোন দিয়ে আগেই অ্যাকাউন্ট তৈরি করা হয়েছে');
          } else {
            toast.error('অ্যাকাউন্ট তৈরি ব্যর্থ হয়েছে');
          }
        } else {
          toast.success('অ্যাকাউন্ট তৈরি হয়েছে!');
          navigate('/my-account');
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!forgotEmail) {
      toast.error('ইমেইল দিন');
      return;
    }

    setIsLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: redirectUrl,
      });

      if (error) {
        toast.error('রিসেট লিংক পাঠানো ব্যর্থ হয়েছে');
      } else {
        toast.success('পাসওয়ার্ড রিসেট লিংক ইমেইলে পাঠানো হয়েছে!');
        setIsForgotPassword(false);
        setForgotEmail('');
      }
    } catch (error) {
      toast.error('কিছু ভুল হয়েছে');
    } finally {
      setIsLoading(false);
    }
  };

  // Forgot Password View
  if (isForgotPassword) {
    return (
      <div className="min-h-screen flex pt-32 pb-16 bg-muted/30">
        <div className="container-custom">
          <div className="max-w-md mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="bg-card rounded-2xl shadow-xl border border-border overflow-hidden"
            >
              <div className="gradient-hero p-8 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-foreground/10 mb-4">
                  <Mail className="h-8 w-8 text-primary-foreground" />
                </div>
                <h1 className="text-2xl font-display font-bold text-primary-foreground mb-2">
                  পাসওয়ার্ড ভুলে গেছেন?
                </h1>
                <p className="text-primary-foreground/80">
                  আপনার ইমেইলে রিসেট লিংক পাঠানো হবে
                </p>
              </div>

              <div className="p-8">
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      ইমেইল
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="example@email.com"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    variant="cta"
                    size="lg"
                    className="w-full"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <span className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        অপেক্ষা করুন...
                      </span>
                    ) : (
                      'রিসেট লিংক পাঠান'
                    )}
                  </Button>
                </form>

                <div className="mt-6 text-center">
                  <button
                    type="button"
                    onClick={() => setIsForgotPassword(false)}
                    className="text-primary font-medium hover:underline inline-flex items-center gap-1"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    লগইনে ফিরে যান
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex pt-32 pb-16 bg-muted/30">
      <div className="container-custom">
        <div className="max-w-md mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="bg-card rounded-2xl shadow-xl border border-border overflow-hidden"
          >
            {/* Header */}
            <div className="gradient-hero p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-foreground/10 mb-4">
                <ShoppingBag className="h-8 w-8 text-primary-foreground" />
              </div>
              <h1 className="text-2xl font-display font-bold text-primary-foreground mb-2">
                {isLogin ? 'লগইন করুন' : 'অ্যাকাউন্ট তৈরি করুন'}
              </h1>
              <p className="text-primary-foreground/80">
                {isLogin 
                  ? 'আপনার অ্যাকাউন্টে প্রবেশ করুন'
                  : 'নতুন অ্যাকাউন্ট তৈরি করতে তথ্য দিন'
                }
              </p>
            </div>

            {/* Form */}
            <div className="p-8">
              <form onSubmit={handleSubmit} className="space-y-4">
                {isLogin ? (
                  <>
                    {/* Login Method Tabs */}
                    <Tabs value={loginMethod} onValueChange={(v) => setLoginMethod(v as 'email' | 'phone')}>
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="phone" className="flex items-center gap-2">
                          <Phone className="h-4 w-4" />
                          ফোন
                        </TabsTrigger>
                        <TabsTrigger value="email" className="flex items-center gap-2">
                          <Mail className="h-4 w-4" />
                          ইমেইল
                        </TabsTrigger>
                      </TabsList>
                      
                      <TabsContent value="email" className="mt-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            ইমেইল
                          </label>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <Input
                              type="email"
                              placeholder="example@email.com"
                              value={formData.email}
                              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                              className="pl-10"
                            />
                          </div>
                          {errors.email && (
                            <p className="text-sm text-destructive mt-1">{errors.email}</p>
                          )}
                        </div>
                      </TabsContent>
                      
                      <TabsContent value="phone" className="mt-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            ফোন নম্বর
                          </label>
                          <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <Input
                              type="tel"
                              placeholder="01XXXXXXXXX"
                              value={formData.phone}
                              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                              className="pl-10"
                            />
                          </div>
                          {errors.phone && (
                            <p className="text-sm text-destructive mt-1">{errors.phone}</p>
                          )}
                        </div>
                      </TabsContent>
                    </Tabs>
                  </>
                ) : (
                  <>
                    {/* Sign Up Fields */}
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        পুরো নাম
                      </label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="আপনার নাম"
                          value={formData.fullName}
                          onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                          className="pl-10"
                        />
                      </div>
                      {errors.fullName && (
                        <p className="text-sm text-destructive mt-1">{errors.fullName}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        ইমেইল <span className="text-muted-foreground text-xs">(ইমেইল অথবা ফোন একটি আবশ্যক)</span>
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                          type="email"
                          placeholder="example@email.com"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="pl-10"
                        />
                      </div>
                      {errors.email && (
                        <p className="text-sm text-destructive mt-1">{errors.email}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        ফোন নম্বর <span className="text-muted-foreground text-xs">(ইমেইল অথবা ফোন একটি আবশ্যক)</span>
                      </label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                          type="tel"
                          placeholder="01XXXXXXXXX"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          className="pl-10"
                        />
                      </div>
                      {errors.phone && (
                        <p className="text-sm text-destructive mt-1">{errors.phone}</p>
                      )}
                    </div>
                  </>
                )}

                {/* Password Field */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    পাসওয়ার্ড
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="pl-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-sm text-destructive mt-1">{errors.password}</p>
                  )}
                </div>

                {/* Forgot Password Link - Only show on login */}
                {isLogin && loginMethod === 'email' && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => setIsForgotPassword(true)}
                      className="text-sm text-primary hover:underline"
                    >
                      পাসওয়ার্ড ভুলে গেছেন?
                    </button>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="cta"
                  size="lg"
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <span className="flex items-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      অপেক্ষা করুন...
                    </span>
                  ) : (
                    <>
                      {isLogin ? 'লগইন করুন' : 'অ্যাকাউন্ট তৈরি করুন'}
                      <ArrowRight className="h-5 w-5 ml-2" />
                    </>
                  )}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <p className="text-muted-foreground">
                  {isLogin ? 'অ্যাকাউন্ট নেই?' : 'আগেই অ্যাকাউন্ট আছে?'}
                  {' '}
                  <button
                    type="button"
                    onClick={() => {
                      setIsLogin(!isLogin);
                      setErrors({});
                    }}
                    className="text-primary font-medium hover:underline"
                  >
                    {isLogin ? 'অ্যাকাউন্ট তৈরি করুন' : 'লগইন করুন'}
                  </button>
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
