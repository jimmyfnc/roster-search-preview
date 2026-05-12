
import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { usePersonnelById } from "../hooks/usePersonnel";
import { getFullName, getTotalCompensation, formatHeight } from "../types";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield, DollarSign, X, ZoomIn } from "lucide-react";
import { getPhotoUrlVariations } from "@/utils/photoUtils";
import { useRosterUrlState } from "../hooks/useUrlState";

const ProfileDetails = () => {
  const { id } = useParams<{ id: string }>();
  const { data: person, isLoading, error } = usePersonnelById(id || "");
  const [isImageZoomed, setIsImageZoomed] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const { getReturnPath } = useRosterUrlState();

  // Check for working photo URL by trying multiple variations (same logic as ProfileCard)
  useEffect(() => {
    if (!person) {
      setPhotoUrl(null);
      return;
    }
    
    const findWorkingPhotoUrl = async () => {
      const potentialUrls = getPhotoUrlVariations(person);
      if (potentialUrls.length === 0) {
        setPhotoUrl(null);
        return;
      }
      
      // Try each URL variation until we find one that works
      for (const url of potentialUrls) {
        try {
          const success = await new Promise<boolean>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
          });
          
          if (success) {
            setPhotoUrl(url);
            return;
          }
        } catch {
          continue;
        }
      }
      
      // If no variation worked, set to null
      setPhotoUrl(null);
    };
    
    findWorkingPhotoUrl();
  }, [person]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-inadvertent-yellow"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive mb-4">Access Denied</h1>
          <p className="text-muted-foreground mb-6">You need to be authenticated to view public records.</p>
          <Link to={getReturnPath()}>
            <Button className="bg-inadvertent-yellow text-inadvertent-dark-text">
              <ArrowLeft size={16} /> Return to Results
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!person) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-4">Profile Not Found</h1>
          <p className="text-muted-foreground mb-6">The requested profile could not be found.</p>
          <Link to={getReturnPath()}>
            <Button className="bg-inadvertent-yellow text-inadvertent-dark-text">
              <ArrowLeft size={16} /> Return to Results
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const fullName = getFullName(person);
  const initials = `${person.first_name?.[0] || ''}${person.last_name?.[0] || ''}`;
  // Production-safe currency formatting function
  const formatCurrency = (value: number | null | undefined): string => {
    if (value === null || value === undefined || isNaN(value) || value <= 0) {
      return '$0.00';
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  // Production-safe total calculation
  const calculateTotalCompensation = (): string => {
    try {
      // Manual calculation to bypass any caching issues
      const regularPayNum = parseFloat(String(person.regular_pay || '0')) || 0;
      const premiumsNum = parseFloat(String(person.premiums || '0')) || 0;
      const overtimeNum = parseFloat(String(person.overtime || '0')) || 0;
      const payoutNum = parseFloat(String(person.payout || '0')) || 0;
      const otherPayNum = parseFloat(String(person.other_pay || '0')) || 0;
      const healthNum = parseFloat(String(person.health_dental_vision || '0')) || 0;
      
      // Development-only debugging
      if (process.env.NODE_ENV === 'development') {
        console.log('Compensation calculation debug:', {
          regular_pay: regularPayNum,
          premiums: premiumsNum,
          overtime: overtimeNum,
          payout: payoutNum,
          other_pay: otherPayNum,
          health_dental_vision: healthNum
        });
      }
      
      // Force numerical addition
      const manualTotal = regularPayNum + premiumsNum + overtimeNum + payoutNum + otherPayNum + healthNum;
      
      return manualTotal > 0 ? formatCurrency(manualTotal) : 'Not available';
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error calculating total compensation:', error);
      }
      return 'Not available';
    }
  };

  const formattedCompensation = calculateTotalCompensation();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <Link to={getReturnPath()} className="inline-flex items-center text-foreground hover:text-foreground mb-6">
          <Button variant="outline" className="border-foreground text-foreground hover:bg-foreground/10 text-lg px-6 py-3">
            <ArrowLeft size={20} className="mr-2" /> Back to Results
          </Button>
        </Link>
        
        {/* Enhanced Profile Details Card - No gray background */}
        <div className="w-full max-w-3xl mx-auto bg-card rounded-lg shadow-lg border border-border">
          {/* Header Section with Enhanced Styling */}
          <div className="bg-card p-8 rounded-t-lg">
            <div className="flex flex-col lg:flex-row items-center lg:items-start gap-8">
              {/* Enhanced Profile Picture with Zoom */}
              <div className="relative group">
                <div
                  className="relative h-56 w-44 sm:h-72 sm:w-56 bg-secondary border-4 border-foreground flex-shrink-0 rounded-lg overflow-hidden cursor-pointer transition-transform hover:scale-105 shadow-lg"
                  onClick={() => setIsImageZoomed(true)}
                >
                  {photoUrl ? (
                    <img
                      src={photoUrl}
                      alt={fullName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-secondary flex items-center justify-center">
                      <span className="text-foreground font-bold text-2xl sm:text-3xl">{initials}</span>
                    </div>
                  )}
                  {/* Zoom indicator */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <ZoomIn className="text-white opacity-0 group-hover:opacity-100 transition-opacity" size={32} />
                  </div>
                </div>
              </div>
              
              {/* Enhanced Personnel Information */}
              <div className="flex flex-col items-center lg:items-start flex-1 space-y-6">
                <h1 className="text-4xl lg:text-5xl font-bold text-foreground text-center lg:text-left leading-tight">{fullName}</h1>
                
                {/* Enhanced Personnel Information - Clean Layout */}
                <div className="flex flex-col gap-3 w-full max-w-md text-center lg:text-left">
                  {person.classification && (
                    <div className="py-2">
                      <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">Rank</div>
                      <div className="text-2xl font-bold text-foreground">{person.classification}</div>
                    </div>
                  )}
                  
                  {person.division && (
                    <div className="py-2">
                      <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">Division</div>
                      <div className="text-2xl font-bold text-foreground">{person.division}</div>
                    </div>
                  )}
                  
                  {person.badge_number && (
                    <div className="py-2">
                      <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">Badge Number</div>
                      <div className="text-2xl font-bold text-foreground">{person.badge_number}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Personal Details Section */}
          {(person.gender || person.ethnicity || person.height || person.weight || person.year_of_hire) && (
            <div className="p-8 border-t border-border">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {person.year_of_hire && (
                  <div className="border-l-4 border-foreground pl-6 py-2">
                    <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2 block">Year of Hire</span>
                    <p className="text-xl font-bold text-foreground">{person.year_of_hire}</p>
                  </div>
                )}
                {person.gender && (
                  <div className="border-l-4 border-foreground pl-6 py-2">
                    <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2 block">Gender</span>
                    <p className="text-xl font-bold text-foreground">{person.gender}</p>
                  </div>
                )}
                {person.ethnicity && (
                  <div className="border-l-4 border-foreground pl-6 py-2">
                    <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2 block">Ethnicity</span>
                    <p className="text-xl font-bold text-foreground">{person.ethnicity}</p>
                  </div>
                )}
                {person.height && (
                  <div className="border-l-4 border-foreground pl-6 py-2">
                    <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2 block">Height</span>
                    <p className="text-xl font-bold text-foreground">{formatHeight(person.height)}</p>
                  </div>
                )}
                {person.weight && (
                  <div className="border-l-4 border-foreground pl-6 py-2">
                    <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2 block">Weight</span>
                    <p className="text-xl font-bold text-foreground">{person.weight} lbs</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Data Disclaimer */}
          <div className="px-8 py-4 bg-secondary border-t border-border">
            <p className="text-sm text-muted-foreground text-center">
              {person.payroll_year
                ? `Disclaimer: Payroll data is current as of ${person.payroll_year}.`
                : 'Disclaimer: No payroll data available for this record.'}
            </p>
          </div>
          
          {/* Enhanced Compensation Section */}
          <div className="p-8">
            <h2 className="text-2xl font-bold text-foreground mb-8 border-b-2 border-foreground pb-3">
              Payment Information
            </h2>
            <div className="flex flex-col gap-6">
              {person.regular_pay != null && Number(person.regular_pay) > 0 && (
                <div className="border-l-4 border-foreground pl-6 py-2">
                  <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2 block">Regular Pay</span>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(Number(person.regular_pay))}
                  </p>
                </div>
              )}

              {person.overtime != null && Number(person.overtime) > 0 && (
                <div className="border-l-4 border-foreground pl-6 py-2">
                  <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2 block">Overtime</span>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(Number(person.overtime))}
                  </p>
                </div>
              )}

              {person.premiums != null && Number(person.premiums) > 0 && (
                <div className="border-l-4 border-foreground pl-6 py-2">
                  <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2 block">Premiums</span>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(Number(person.premiums))}
                  </p>
                </div>
              )}

              {person.health_dental_vision != null && Number(person.health_dental_vision) > 0 && (
                <div className="border-l-4 border-foreground pl-6 py-2">
                  <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2 block">Health/Dental/Vision</span>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(Number(person.health_dental_vision))}
                  </p>
                </div>
              )}

              {person.payout != null && Number(person.payout) > 0 && (
                <div className="border-l-4 border-foreground pl-6 py-2">
                  <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2 block">Payout</span>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(Number(person.payout))}
                  </p>
                </div>
              )}

              <div className="border-l-4 border-foreground pl-6 py-2">
                <span className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2 block">Total Compensation</span>
                <p className="text-3xl font-bold text-foreground">
                  {formattedCompensation}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Image Zoom Modal - Enlarged by 40% */}
      {isImageZoomed && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setIsImageZoomed(false)}
        >
          <div className="relative">
            <button
              onClick={() => setIsImageZoomed(false)}
              className="absolute -top-12 right-0 text-foreground hover:text-muted-foreground transition-colors"
              aria-label="Close zoom view"
            >
              <X size={32} />
            </button>
            <div className="bg-card p-3 rounded-lg shadow-2xl">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={fullName}
                  className="w-80 h-96 sm:w-96 sm:h-[480px] object-cover rounded"
                  style={{ minWidth: '320px', minHeight: '400px' }}
                />
              ) : (
                <div className="w-80 h-96 sm:w-96 sm:h-[480px] bg-secondary flex items-center justify-center rounded">
                  <span className="text-foreground font-bold text-8xl">{initials}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileDetails;
